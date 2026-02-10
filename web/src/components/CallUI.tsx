import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store';
import * as api from '../api';
import { Avatar, IconPhone, IconPhoneOff } from './ui';

const STUN_SERVER = 'stun:stun.l.google.com:19302';
const CALL_AVATAR_SIZE_DEFAULT = 120;
const CALL_AVATAR_SIZE_SMALL = 96;
const BREAKPOINT_SMALL = 400;

function formatCallDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function CallUI() {
  const {
    callState, callId, callPeerId, callFromUserId, callStartTime, callIsCaller, callError, callConnectDeadline,
    acceptCall, rejectCall, hangupCall, setCallSignalingHandler, chats,
  } = useChatStore();

  const [connectSecondsLeft, setConnectSecondsLeft] = useState<number | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: STUN_SERVER }]);
  const [duration, setDuration] = useState(0);
  const [avatarSize, setAvatarSize] = useState(CALL_AVATAR_SIZE_DEFAULT);

  useEffect(() => {
    const updateSize = () => setAvatarSize(window.innerWidth < BREAKPOINT_SMALL ? CALL_AVATAR_SIZE_SMALL : CALL_AVATAR_SIZE_DEFAULT);
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getCallConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg?.ice_servers && cfg.ice_servers.length > 0) {
          iceServersRef.current = cfg.ice_servers;
        }
      })
      .catch(() => { /* optional config */ });
    return () => { cancelled = true; };
  }, []);

  const peerUid = callPeerId || callFromUserId;
  const peerMember = peerUid
    ? chats.find((c) => c.chat.chat_type === 'personal' && c.members?.some((m) => m.id === peerUid))?.members?.find((m) => m.id === peerUid)
    : null;
  const peerName = peerMember?.username ?? (peerUid ? 'Звонок' : 'Звонок');
  const peerAvatarUrl = peerMember?.avatar_url;

  useEffect(() => {
    if (callState !== 'in_call' || !callStartTime) return;
    const t = setInterval(() => setDuration(Date.now() - callStartTime), 1000);
    return () => clearInterval(t);
  }, [callState, callStartTime]);

  useEffect(() => {
    if (callState !== 'calling' || !callConnectDeadline || callId) {
      setConnectSecondsLeft(null);
      return;
    }
    const update = () => {
      const left = Math.max(0, Math.ceil((callConnectDeadline - Date.now()) / 1000));
      setConnectSecondsLeft(left);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [callState, callConnectDeadline, callId]);

  useEffect(() => {
    if (callState !== 'in_call' || !callId) return;

    if (!window.isSecureContext) {
      useChatStore.getState().setNotification('Звонки работают только по HTTPS (или localhost).');
      useChatStore.getState().hangupCall();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      useChatStore.getState().setNotification('Браузер не поддерживает доступ к микрофону.');
      useChatStore.getState().hangupCall();
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peerConnectionRef.current = pc;

    const cleanup = () => {
      pc.close();
      peerConnectionRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    };

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      })
      .catch((err) => {
        console.error('getUserMedia:', err);
        useChatStore.getState().setNotification('Нет доступа к микрофону');
        useChatStore.getState().hangupCall();
        cleanup();
        return;
      });

    pc.ontrack = (e) => {
      if (!remoteAudioRef.current) return;
      const stream = e.streams?.[0] ?? new MediaStream([e.track]);
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(() => { /* autoplay may be blocked */ });
    };

    const send = (type: string, payload: Record<string, unknown>) => {
      const ws = useChatStore.getState().callWs;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload: { ...payload, call_id: callId } }));
      }
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const json = typeof e.candidate.toJSON === 'function'
        ? e.candidate.toJSON()
        : { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex };
      send('ice', { candidate: JSON.stringify(json) });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        useChatStore.getState().setNotification('Не удалось установить соединение. Проверьте сеть или настройте TURN-сервер.');
        useChatStore.getState().hangupCall();
      }
    };

    const handler = (type: string, payload: any) => {
      if (type === 'offer' && payload?.sdp) {
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }))
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => send('answer', { sdp: pc.localDescription?.sdp }))
          .catch((err) => console.error('answer:', err));
      } else if (type === 'answer' && payload?.sdp) {
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })).catch((err) => console.error('setRemoteDescription:', err));
      } else if (type === 'ice' && payload?.candidate) {
        try {
          const c = JSON.parse(payload.candidate);
          pc.addIceCandidate(new RTCIceCandidate(c)).catch((err) => console.error('addIceCandidate:', err));
        } catch (_) {}
      }
    };

    setCallSignalingHandler(handler);

    if (callIsCaller) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => send('offer', { sdp: pc.localDescription?.sdp }))
        .catch((err) => console.error('offer:', err));
    }

    return () => {
      setCallSignalingHandler(null);
      cleanup();
    };
  }, [callState, callId, callIsCaller, setCallSignalingHandler]);

  useEffect(() => {
    if (callState !== 'in_call') setDuration(0);
  }, [callState]);

  // —— Входящий звонок (как в Telegram: полноэкран, аватар, Принять / Отклонить) ——
  if (callState === 'ringing') {
    return (
      <div className="call-overlay">
        <div className="call-content">
          <div className="call-avatar-wrap">
            <span className="call-avatar-pulse" aria-hidden />
            <span className="call-avatar-pulse" aria-hidden />
            <span className="call-avatar-pulse" aria-hidden />
            <Avatar name={peerName} url={peerAvatarUrl} size={avatarSize} />
          </div>
          <p className="text-txt dark:text-white text-[clamp(18px,4.5vw,22px)] font-semibold mb-1 w-full">{peerName}</p>
          <p className="text-txt-secondary dark:text-white/70 text-[clamp(14px,3.5vw,15px)] mb-2 w-full">Входящий звонок</p>
          <div className="call-buttons-row">
            <button type="button" onClick={() => rejectCall(callId!)} className="call-btn call-btn-decline" title="Отклонить" aria-label="Отклонить">
              <IconPhoneOff size={28} />
            </button>
            <button type="button" onClick={() => acceptCall(callId!)} className="call-btn call-btn-accept" title="Принять" aria-label="Принять">
              <IconPhone size={28} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // —— Исходящий звонок / ожидание / ошибка (как в Telegram: полноэкран, «Звонок...», сброс) ——
  if (callState === 'calling' || (callError && callState !== 'in_call')) {
    return (
      <div className="call-overlay">
        <div className="call-content">
          <div className="call-avatar-wrap">
            <span className="call-avatar-pulse" aria-hidden />
            <span className="call-avatar-pulse" aria-hidden />
            <span className="call-avatar-pulse" aria-hidden />
            <Avatar name={peerName} url={peerAvatarUrl} size={avatarSize} />
          </div>
          <p className="text-txt dark:text-white text-[clamp(18px,4.5vw,22px)] font-semibold mb-1 w-full">{peerName}</p>
          <p className="text-txt-secondary dark:text-white/70 text-[clamp(14px,3.5vw,15px)] w-full">
            {callError || (connectSecondsLeft !== null ? `Соединение... ${connectSecondsLeft} сек` : 'Звонок...')}
          </p>
          {callError && (
            <p className="text-txt-placeholder dark:text-white/50 text-[13px] mt-1 w-full">Нажмите кнопку, чтобы закрыть</p>
          )}
          <div className="call-buttons-row">
            <button type="button" onClick={hangupCall} className="call-btn call-btn-hangup" title="Завершить" aria-label="Завершить">
              <IconPhoneOff size={28} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // —— Разговор (как в Telegram: полноэкран, аватар, длительность, завершить) ——
  if (callState === 'in_call') {
    return (
      <>
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        <div className="call-overlay">
          <div className="call-content">
            <div className="call-avatar-wrap">
              <Avatar name={peerName} url={peerAvatarUrl} size={avatarSize} />
            </div>
            <p className="text-txt dark:text-white text-[clamp(18px,4.5vw,22px)] font-semibold mb-1 w-full">{peerName}</p>
            <p className="text-txt-secondary dark:text-white/70 text-[clamp(14px,3.5vw,15px)] mb-2 w-full">{formatCallDuration(duration)}</p>
            <div className="call-buttons-row">
              <button type="button" onClick={hangupCall} className="call-btn call-btn-hangup" title="Завершить" aria-label="Завершить">
                <IconPhoneOff size={28} />
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
}
