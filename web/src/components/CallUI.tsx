import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store';
import * as api from '../api';
import { Avatar, IconPhone, IconPhoneOff } from './ui';

const STUN_SERVER = 'stun:stun.l.google.com:19302';
const CALL_AVATAR_SIZE_DEFAULT = 120;
const CALL_AVATAR_SIZE_SMALL = 96;
const BREAKPOINT_SMALL = 400;
const RING_VOLUME = 0.07;
const RINGBACK_FREQ = 425;
const RINGTONE_FREQ = 480;
const RINGBACK_PATTERN: Array<{ on: number; off: number }> = [
  { on: 0.35, off: 0.2 },
  { on: 0.35, off: 2.0 },
];
const RINGTONE_PATTERN: Array<{ on: number; off: number }> = [
  { on: 0.8, off: 0.4 },
  { on: 0.8, off: 2.0 },
];

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
  const ringRef = useRef<{
    ctx: AudioContext;
    osc: OscillatorNode;
    gain: GainNode;
    timer: number | null;
    mode: 'incoming' | 'outgoing';
  } | null>(null);
  const [ringNeedsGesture, setRingNeedsGesture] = useState(false);
  const [remoteNeedsGesture, setRemoteNeedsGesture] = useState(false);
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

  const stopRing = () => {
    const r = ringRef.current;
    if (!r) return;
    if (r.timer) window.clearInterval(r.timer);
    try { r.osc.stop(); } catch (_) {}
    try { r.ctx.close(); } catch (_) {}
    ringRef.current = null;
    setRingNeedsGesture(false);
  };

  const startRing = (mode: 'incoming' | 'outgoing') => {
    if (typeof window === 'undefined') return;
    if (ringRef.current?.mode === mode) return;
    stopRing();
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pattern = mode === 'incoming' ? RINGTONE_PATTERN : RINGBACK_PATTERN;
    const freq = mode === 'incoming' ? RINGTONE_FREQ : RINGBACK_FREQ;
    const cycle = pattern.reduce((s, p) => s + p.on + p.off, 0);

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    const schedule = () => {
      const base = ctx.currentTime + 0.02;
      let t = base;
      for (const seg of pattern) {
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(RING_VOLUME, t + 0.02);
        gain.gain.setValueAtTime(RING_VOLUME, t + Math.max(0.02, seg.on - 0.02));
        gain.gain.linearRampToValueAtTime(0, t + seg.on);
        t += seg.on + seg.off;
      }
    };

    schedule();
    const timer = window.setInterval(schedule, cycle * 1000);
    ringRef.current = { ctx, osc, gain, timer, mode };
    setRingNeedsGesture(false);
    ctx.resume()
      .then(() => {
        if (ctx.state !== 'running') setRingNeedsGesture(true);
      })
      .catch(() => { setRingNeedsGesture(true); });
  };

  useEffect(() => {
    if (callError) {
      stopRing();
      return;
    }
    if (callState === 'calling') startRing('outgoing');
    else if (callState === 'ringing') startRing('incoming');
    else stopRing();
    return () => stopRing();
  }, [callState, callError]);

  const unlockRingAudio = () => {
    if (callState !== 'calling' && callState !== 'ringing') return;
    const mode = callState === 'ringing' ? 'incoming' : 'outgoing';
    if (!ringRef.current) startRing(mode);
    const r = ringRef.current;
    if (!r) return;
    r.ctx.resume()
      .then(() => {
        if (r.ctx.state === 'running') setRingNeedsGesture(false);
      })
      .catch(() => { /* keep prompt */ });
  };

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
    let closed = false;

    const cleanup = () => {
      closed = true;
      pc.close();
      peerConnectionRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    };

    const ensureLocalStream = async (): Promise<MediaStream> => {
      if (localStreamRef.current) return localStreamRef.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (closed) {
          stream.getTracks().forEach((t) => t.stop());
          return stream;
        }
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        return stream;
      } catch (err) {
        console.error('getUserMedia:', err);
        useChatStore.getState().setNotification('Нет доступа к микрофону');
        useChatStore.getState().hangupCall();
        cleanup();
        throw err;
      }
    };

    pc.ontrack = (e) => {
      if (!remoteAudioRef.current) return;
      const stream = e.streams?.[0] ?? new MediaStream([e.track]);
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1;
      remoteAudioRef.current.play()
        .then(() => setRemoteNeedsGesture(false))
        .catch(() => { setRemoteNeedsGesture(true); });
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
          .then(() => ensureLocalStream())
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
      ensureLocalStream()
        .then(() => pc.createOffer())
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => send('offer', { sdp: pc.localDescription?.sdp }))
        .catch((err) => console.error('offer:', err));
    }

    return () => {
      setCallSignalingHandler(null);
      setRemoteNeedsGesture(false);
      cleanup();
    };
  }, [callState, callId, callIsCaller, setCallSignalingHandler]);

  useEffect(() => {
    if (callState !== 'in_call') setDuration(0);
  }, [callState]);

  const unlockRemoteAudio = () => {
    if (!remoteAudioRef.current) return;
    remoteAudioRef.current.muted = false;
    remoteAudioRef.current.volume = 1;
    remoteAudioRef.current.play()
      .then(() => setRemoteNeedsGesture(false))
      .catch(() => { /* keep prompt */ });
  };

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
          {ringNeedsGesture && (
            <button type="button" onClick={unlockRingAudio} className="text-[12px] text-primary hover:underline mb-2">
              Нажмите, чтобы включить звук
            </button>
          )}
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
          {!callError && ringNeedsGesture && (
            <button type="button" onClick={unlockRingAudio} className="text-[12px] text-primary hover:underline mt-2">
              Нажмите, чтобы включить звук
            </button>
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
            {remoteNeedsGesture && (
              <button type="button" onClick={unlockRemoteAudio} className="text-[12px] text-primary hover:underline mb-2">
                Нажмите, чтобы включить звук
              </button>
            )}
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
