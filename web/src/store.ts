import { create } from 'zustand';
import * as api from './api';
import { CACHE_TTL_MS } from './config';
import { updateFaviconBadge } from './faviconBadge';
import { getWebSocketBase } from './serverUrl';
import type { ChatWithLastMessage, Message, UserPublic, PinnedMessage } from './types';

/** "+" в имени файла часто приходит вместо пробела — нормализуем при получении с сервера. */
function normalizeMessageFileName(m: Message): Message {
  if (!m?.file_name) return m;
  const name = m.file_name.replace(/\+/g, ' ').trim();
  return name === m.file_name ? m : { ...m, file_name: name };
}

/* ─── Auth Store ─── */
const SESSION_ID_KEY = 'session_id';
const SESSION_SECRET_KEY = 'session_secret';

interface AuthState {
  user: UserPublic | null;
  isAuthenticated: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string, deviceName?: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  loadUserOrRetry: () => Promise<void>;
  updateProfile: (data: { username?: string; avatar_url?: string; email?: string; phone?: string }) => Promise<void>;
  init: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,

  init: () => {
    const sessionId = localStorage.getItem(SESSION_ID_KEY);
    const sessionSecret = localStorage.getItem(SESSION_SECRET_KEY);
    if (sessionId && sessionSecret) {
      set({ isAuthenticated: true });
      get().loadUser();
    }
  },

  requestCode: async (email) => {
    await api.requestCode(email);
  },

  verifyCode: async (email, code, deviceName) => {
    const res = await api.verifyCode(email, code, deviceName);
    localStorage.setItem(SESSION_ID_KEY, res.session_id);
    localStorage.setItem(SESSION_SECRET_KEY, res.session_secret);
    set({ isAuthenticated: true });
    await get().loadUserOrRetry();
  },

  logout: () => {
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(SESSION_SECRET_KEY);
    set({ user: null, isAuthenticated: false });
    useChatStore.getState().reset();
  },

  loadUser: async () => {
    try {
      const user = await api.getMe();
      set({ user });
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) {
        get().logout();
      } else {
        set({ user: null });
      }
    }
  },

  /** Загрузка профиля с однократным повтором при 401 (сессия могла ещё не попасть в Redis). */
  loadUserOrRetry: async () => {
    try {
      const user = await api.getMe();
      set({ user });
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          const user = await api.getMe();
          set({ user });
        } catch (retryErr) {
          if (retryErr instanceof api.ApiError && (retryErr as api.ApiError).status === 401) {
            get().logout();
          } else {
            set({ user: null });
          }
        }
      } else {
        set({ user: null });
      }
    }
  },

  updateProfile: async (data) => {
    const user = await api.updateProfile(data);
    set({ user });
  },
}));

/* ─── Theme Store (light / dark / system) ─── */
export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_KEY = 'compass-theme';

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function setThemeColorMeta(dark: boolean) {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1C1C1C' : '#F8F8F8');
}

function applyTheme(dark: boolean) {
  if (typeof document === 'undefined') return;
  if (dark) document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  setThemeColorMeta(dark);
}

interface ThemeState {
  preference: ThemePreference;
  isDark: boolean;
  setTheme: (preference: ThemePreference) => void;
  init: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  isDark: false,

  setTheme: (preference) => {
    localStorage.setItem(THEME_KEY, preference);
    const isDark = preference === 'dark' || (preference === 'system' && getSystemDark());
    applyTheme(isDark);
    set({ preference, isDark });
  },

  init: () => {
    const stored = localStorage.getItem(THEME_KEY) as ThemePreference | null;
    const preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const isDark = preference === 'dark' || (preference === 'system' && getSystemDark());
    applyTheme(isDark);
    set({ preference, isDark });
    if (preference === 'system' && typeof window !== 'undefined') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const next = getSystemDark();
        applyTheme(next);
        set({ isDark: next });
      });
    }
  },
}));

/* ─── Chat Store ─── */
interface ChatState {
  chats: ChatWithLastMessage[];
  activeChatId: string | null;
  messages: Record<string, Message[]>;
  typingUsers: Record<string, string[]>;
  onlineUsers: Record<string, boolean>;
  pinnedMessages: Record<string, PinnedMessage[]>;
  favoriteChatIds: string[];
  lastChatsFetchAt: number;
  lastFavoritesFetchAt: number;
  cacheTTLMs: number;
  replyTo: Message | null;
  editingMessage: Message | null;
  notification: string | null;
  setNotification: (text: string | null) => void;
  ws: WebSocket | null;
  wsReconnectAttempt: number;
  wsReconnectTimer: ReturnType<typeof setTimeout> | null;
  pendingMessages: { chatId: string; content: string; opts?: { contentType?: string; fileUrl?: string; fileName?: string; fileSize?: number; replyToId?: string } }[];

  callWs: WebSocket | null;
  callState: 'idle' | 'calling' | 'ringing' | 'in_call';
  callId: string | null;
  callPeerId: string | null;
  callFromUserId: string | null;
  callStartTime: number | null;
  callIsCaller: boolean;
  callError: string | null;
  pendingStartCall: string | null;
  callSignalingHandler: ((type: string, payload: any) => void) | null;
  /** Очередь offer/answer/ice, пришедших до установки handler (чтобы не потерять первый offer). */
  callSignalingQueue: { type: string; payload: any }[];
  callConnectDeadline: number | null;
  callConnectTimer: ReturnType<typeof setTimeout> | null;
  connectCallWS: () => Promise<void>;
  startCall: (peerId: string) => void;
  acceptCall: (callId: string) => void;
  rejectCall: (callId: string) => void;
  hangupCall: () => void;
  setCallSignalingHandler: (handler: ((type: string, payload: any) => void) | null) => void;
  handleCallWSMessage: (data: { type: string; payload: any }) => void;

  fetchChats: () => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  fetchMessages: (chatId: string) => Promise<void>;
  sendMessage: (chatId: string, content: string, opts?: { contentType?: string; fileUrl?: string; fileName?: string; fileSize?: number; replyToId?: string }) => void;
  sendTyping: (chatId: string) => void;
  markAsRead: (chatId: string) => void;
  editMessage: (messageId: string, content: string) => void;
  deleteMessage: (messageId: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  pinMessage: (chatId: string, messageId: string) => void;
  unpinMessage: (chatId: string, messageId: string) => void;
  fetchPinnedMessages: (chatId: string) => Promise<void>;
  fetchFavorites: () => Promise<void>;
  fetchChatsIfStale: () => Promise<void>;
  fetchFavoritesIfStale: () => Promise<void>;
  loadCacheConfig: () => Promise<void>;
  invalidateChatsCache: () => void;
  invalidateFavoritesCache: () => void;
  hydrateFavoritesFromStorage: () => void;
  addFavorite: (chatId: string) => Promise<void>;
  removeFavorite: (chatId: string) => Promise<void>;
  toggleFavorite: (chatId: string) => Promise<void>;
  setReplyTo: (msg: Message | null) => void;
  setEditingMessage: (msg: Message | null) => void;
  connectWS: () => void;
  disconnectWS: () => void;
  flushPendingMessages: () => void;
  createPersonalChat: (userId: string) => Promise<ChatWithLastMessage>;
  createGroupChat: (name: string, memberIds: string[]) => Promise<ChatWithLastMessage>;
  searchUsers: (query: string) => Promise<UserPublic[]>;
  searchMessages: (query: string, chatId?: string) => Promise<Message[]>;
  uploadFile: (file: File) => Promise<{ url: string; file_name: string; file_size: number; content_type: string }>;
  uploadVoice: (file: File) => Promise<{ url: string; file_name: string; file_size: number; content_type: string }>;
  addOptimisticVoiceMessage: (chatId: string) => string;
  removeOptimisticMessage: (chatId: string, optId: string) => void;
  updateOptimisticVoiceMessage: (chatId: string, optId: string, opts: { fileUrl: string; fileName?: string; fileSize?: number }) => void;
  sendMessageWsOnly: (chatId: string, content: string, opts?: { contentType?: string; fileUrl?: string; fileName?: string; fileSize?: number; replyToId?: string }) => void;
  leaveChat: (chatId: string) => Promise<void>;
  handleWSMessage: (data: { type: string; payload: any }) => void;
  updateElectronBadge: () => void;
  reset: () => void;
}

function favoritesStorageKey(userId: string): string {
  return `compass-favorites-${userId || 'anon'}`;
}

// Таймеры снятия «печатает» по (chat_id:user_id); сбрасываются при новом typing-событии
const typingClearTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

// Время отключения WS; при переподключении после долгого простоя — полное обновление страницы (перезапуск докера)
let wsDisconnectedAt: number | null = null;
const WS_LONG_DISCONNECT_MS = 5000;

function loadFavoritesFromStorage(userId: string): string[] {
  try {
    const s = localStorage.getItem(favoritesStorageKey(userId));
    if (s) {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return a;
    }
  } catch { /* ignore */ }
  return [];
}

function saveFavoritesToStorage(userId: string, ids: string[]) {
  try {
    localStorage.setItem(favoritesStorageKey(userId), JSON.stringify(ids));
  } catch { /* ignore */ }
}

let chatsFetchId = 0

const initialChatState = {
  chats: [] as ChatWithLastMessage[],
  activeChatId: null as string | null,
  messages: {} as Record<string, Message[]>,
  typingUsers: {} as Record<string, string[]>,
  onlineUsers: {} as Record<string, boolean>,
  pinnedMessages: {} as Record<string, PinnedMessage[]>,
  favoriteChatIds: [] as string[],
  lastChatsFetchAt: 0 as number,
  lastFavoritesFetchAt: 0 as number,
  cacheTTLMs: CACHE_TTL_MS,
  replyTo: null as Message | null,
  editingMessage: null as Message | null,
  notification: null as string | null,
  setNotification: (() => {}) as (text: string | null) => void,
  ws: null as WebSocket | null,
  wsReconnectAttempt: 0,
  wsReconnectTimer: null as ReturnType<typeof setTimeout> | null,
  pendingMessages: [] as { chatId: string; content: string; opts?: { contentType?: string; fileUrl?: string; fileName?: string; fileSize?: number; replyToId?: string } }[],

  callWs: null as WebSocket | null,
  callState: 'idle' as 'idle' | 'calling' | 'ringing' | 'in_call',
  callId: null as string | null,
  callPeerId: null as string | null,
  callFromUserId: null as string | null,
  callStartTime: null as number | null,
  callIsCaller: false,
  callError: null as string | null,
  pendingStartCall: null as string | null,
  callSignalingHandler: null as ((type: string, payload: any) => void) | null,
  callSignalingQueue: [] as { type: string; payload: any }[],
  callConnectDeadline: null as number | null,
  callConnectTimer: null as ReturnType<typeof setTimeout> | null,
  connectCallWS: async () => {},
  startCall: () => {},
  acceptCall: () => {},
  rejectCall: () => {},
  hangupCall: () => {},
  setCallSignalingHandler: () => {},
};

const CALL_CONNECT_TIMEOUT_MS = 30000;

export const useChatStore = create<ChatState>((set, get) => ({
  ...initialChatState,

  setNotification: (text) => set({ notification: text }),

  fetchChats: async () => {
    const requestId = ++chatsFetchId
    const prev = get();
    let chats: ChatWithLastMessage[];
    let favoriteIds: string[] | null = null;
    try {
      chats = await api.getChats();
    } catch {
      return // при ошибке не трогаем список — остаётся предыдущее состояние
    }
    if (requestId !== chatsFetchId) return // устаревший ответ при быстром переключении — не перезаписываем
    try {
      const ids = await api.getFavorites();
      favoriteIds = Array.isArray(ids) ? ids : [];
    } catch {
      favoriteIds = null
    }
    chats = chats.map((c) =>
      c.last_message ? { ...c, last_message: normalizeMessageFileName(c.last_message) } : c
    );
    chats.sort((a, b) => {
      const at = a.last_message?.created_at || a.chat.created_at;
      const bt = b.last_message?.created_at || b.chat.created_at;
      return new Date(bt).getTime() - new Date(at).getTime();
    });
    const onlineUsers: Record<string, boolean> = {};
    for (const c of chats) {
      for (const m of c.members) {
        onlineUsers[m.id] = m.is_online;
      }
    }
    const next: { chats: ChatWithLastMessage[]; onlineUsers: Record<string, boolean>; favoriteChatIds?: string[] } = { chats, onlineUsers };
    if (favoriteIds !== null) {
      next.favoriteChatIds = favoriteIds;
      const uid = useAuthStore.getState().user?.id;
      if (uid) saveFavoritesToStorage(uid, favoriteIds);
    } else {
      next.favoriteChatIds = prev.favoriteChatIds
    }
    set({ ...next, lastChatsFetchAt: Date.now() });
    get().updateElectronBadge();
  },

  setActiveChat: (chatId) => {
    set({ activeChatId: chatId, replyTo: null, editingMessage: null });
    if (chatId) {
      get().fetchMessages(chatId);
      get().markAsRead(chatId);
      get().fetchPinnedMessages(chatId);
    }
  },

  fetchMessages: async (chatId) => {
    const msgs = (await api.getMessages(chatId, 100, 0)).map(normalizeMessageFileName);
    msgs.reverse();
    set((s) => {
      const existing = s.messages[chatId] || [];
      const optimistic = existing.filter((m) => m.id.startsWith('opt-'));
      const merged = [...msgs];
      for (const opt of optimistic) {
        if (!merged.some((m) => m.id === opt.id)) merged.push(opt);
      }
      merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return { messages: { ...s.messages, [chatId]: merged } };
    });
  },

  sendMessage: (chatId, content, opts) => {
    const { ws, replyTo } = get();
    const user = useAuthStore.getState().user;
    const now = new Date().toISOString();

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const optId = `opt-pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const optimistic: Message = {
        id: optId,
        chat_id: chatId,
        sender_id: user?.id ?? '',
        content,
        content_type: (opts?.contentType as Message['content_type']) || 'text',
        file_url: opts?.fileUrl ?? '',
        file_name: opts?.fileName ?? '',
        file_size: opts?.fileSize ?? 0,
        status: 'sent',
        is_deleted: false,
        created_at: now,
        sender: user ? { ...user, is_online: true, last_seen_at: now } : undefined,
        reply_to_id: opts?.replyToId || replyTo?.id,
        reply_to: replyTo ?? undefined,
      };
      set((s) => {
        const nextMessages = { ...s.messages, [chatId]: [...(s.messages[chatId] || []), optimistic] };
        const nextChats = s.chats.map((c) =>
          c.chat.id === chatId ? { ...c, last_message: optimistic } : c
        );
        nextChats.sort((a, b) => {
          const at = a.last_message?.created_at || a.chat.created_at;
          const bt = b.last_message?.created_at || b.chat.created_at;
          return new Date(bt).getTime() - new Date(at).getTime();
        });
        return {
          messages: nextMessages,
          chats: nextChats,
          replyTo: null,
          pendingMessages: [...s.pendingMessages, { chatId, content, opts: { ...opts, replyToId: opts?.replyToId || replyTo?.id } }],
        };
      });
      get().setNotification('Сообщение будет отправлено при появлении связи.');
      return;
    }

    const optId = `opt-${Date.now()}`;
    const optimistic: Message = {
      id: optId,
      chat_id: chatId,
      sender_id: user?.id ?? '',
      content,
      content_type: (opts?.contentType as Message['content_type']) || 'text',
      file_url: opts?.fileUrl ?? '',
      file_name: opts?.fileName ?? '',
      file_size: opts?.fileSize ?? 0,
      status: 'sent',
      is_deleted: false,
      created_at: now,
      sender: user ? { ...user, is_online: true, last_seen_at: now } : undefined,
      reply_to_id: opts?.replyToId || replyTo?.id,
      reply_to: replyTo ?? undefined,
    };
    set((s) => {
      const nextMessages = { ...s.messages, [chatId]: [...(s.messages[chatId] || []), optimistic] };
      const nextChats = s.chats.map((c) =>
        c.chat.id === chatId ? { ...c, last_message: optimistic } : c
      );
      nextChats.sort((a, b) => {
        const at = a.last_message?.created_at || a.chat.created_at;
        const bt = b.last_message?.created_at || b.chat.created_at;
        return new Date(bt).getTime() - new Date(at).getTime();
      });
      return { messages: nextMessages, chats: nextChats, replyTo: null };
    });
    try {
      ws.send(JSON.stringify({
        type: 'new_message',
        chat_id: chatId,
        content,
        content_type: opts?.contentType || 'text',
        file_url: opts?.fileUrl || '',
        file_name: opts?.fileName || '',
        file_size: opts?.fileSize || 0,
        reply_to_id: opts?.replyToId || replyTo?.id || '',
      }));
    } catch (e) {
      console.error('ws send error:', e);
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] || []).filter((m) => m.id !== optId),
        },
      }));
    }
  },

  sendTyping: (chatId) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'typing', chat_id: chatId }));
  },

  markAsRead: (chatId) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'message_read', chat_id: chatId }));
    }
    set((s) => ({
      chats: s.chats.map((c) => c.chat.id === chatId ? { ...c, unread_count: 0 } : c),
    }));
    get().updateElectronBadge();
  },

  updateElectronBadge: () => {
    if (typeof window === 'undefined') return;
    const total = get().chats.reduce((n, c) => n + (c.unread_count || 0), 0);
    document.title = total > 0 ? `(${total}) Мессенджер` : 'Мессенджер';
    updateFaviconBadge(total);
    const api = (window as unknown as { electronAPI?: { setBadgeCount?: (n: number) => void } }).electronAPI;
    if (api?.setBadgeCount) {
      api.setBadgeCount(total);
      return;
    }
    const nav = navigator as Navigator & { setAppBadge?(n: number): Promise<void>; clearAppBadge?(): Promise<void> };
    if (nav.setAppBadge) {
      if (total > 0) nav.setAppBadge(total).catch(() => {});
      else nav.clearAppBadge?.().catch(() => {});
    }
  },

  editMessage: (messageId, content) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'message_edited', message_id: messageId, content })); } catch { /* */ }
    set({ editingMessage: null });
  },

  deleteMessage: (messageId) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'message_deleted', message_id: messageId })); } catch { /* */ }
  },

  addReaction: (messageId, emoji) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'reaction_added', message_id: messageId, emoji })); } catch { /* */ }
  },

  removeReaction: (messageId, emoji) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'reaction_removed', message_id: messageId, emoji })); } catch { /* */ }
  },

  pinMessage: (chatId, messageId) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'message_pinned', chat_id: chatId, message_id: messageId })); } catch { /* */ }
  },

  unpinMessage: (chatId, messageId) => {
    set((s) => ({
      pinnedMessages: {
        ...s.pinnedMessages,
        [chatId]: (s.pinnedMessages[chatId] || []).filter((p) => p.message_id !== messageId),
      },
    }));
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'message_unpinned', chat_id: chatId, message_id: messageId })); } catch { /* */ }
  },

  fetchPinnedMessages: async (chatId) => {
    try {
      const pinned = await api.getPinnedMessages(chatId);
      const normalized = pinned.map((p) =>
        p.message ? { ...p, message: normalizeMessageFileName(p.message) } : p
      );
      set((s) => ({ pinnedMessages: { ...s.pinnedMessages, [chatId]: normalized } }));
    } catch { /* ignore */ }
  },

  fetchFavorites: async () => {
    try {
      const chatIds = await api.getFavorites();
      const ids = Array.isArray(chatIds) ? chatIds : [];
      set({ favoriteChatIds: ids, lastFavoritesFetchAt: Date.now() });
      const uid = useAuthStore.getState().user?.id;
      if (uid) saveFavoritesToStorage(uid, ids);
    } catch { /* при ошибке не трогаем избранное — остаётся из storage */ }
  },

  fetchChatsIfStale: async () => {
    const s = get();
    const ttl = s.cacheTTLMs || CACHE_TTL_MS;
    if (s.lastChatsFetchAt > 0 && Date.now() - s.lastChatsFetchAt <= ttl) return;
    await get().fetchChats();
  },

  fetchFavoritesIfStale: async () => {
    const s = get();
    const ttl = s.cacheTTLMs || CACHE_TTL_MS;
    if (s.lastFavoritesFetchAt > 0 && Date.now() - s.lastFavoritesFetchAt <= ttl) return;
    await get().fetchFavorites();
  },

  loadCacheConfig: async () => {
    try {
      const res = await api.getCacheConfig();
      if (res?.ttl_minutes > 0) {
        set({ cacheTTLMs: res.ttl_minutes * 60 * 1000 });
      }
    } catch { /* оставляем значение по умолчанию */ }
  },

  invalidateChatsCache: () => set({ lastChatsFetchAt: 0 }),
  invalidateFavoritesCache: () => set({ lastFavoritesFetchAt: 0 }),

  hydrateFavoritesFromStorage: () => {
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;
    const ids = loadFavoritesFromStorage(uid);
    if (ids.length > 0) set({ favoriteChatIds: ids });
  },

  addFavorite: async (chatId) => {
    const prev = get().favoriteChatIds || [];
    const next = Array.isArray(prev) && prev.includes(chatId) ? prev : [...(Array.isArray(prev) ? prev : []), chatId];
    set({ favoriteChatIds: next });
    const uid = useAuthStore.getState().user?.id;
    if (uid) saveFavoritesToStorage(uid, next);
    try {
      await api.addFavorite(chatId);
      set({ lastFavoritesFetchAt: Date.now() });
    } catch {
      set({ favoriteChatIds: prev });
      if (uid) saveFavoritesToStorage(uid, prev);
      get().setNotification('Не удалось добавить в избранное');
    }
  },

  removeFavorite: async (chatId) => {
    const prev = get().favoriteChatIds || [];
    const next = (Array.isArray(prev) ? prev : []).filter((id) => id !== chatId);
    set({ favoriteChatIds: next });
    const uid = useAuthStore.getState().user?.id;
    if (uid) saveFavoritesToStorage(uid, next);
    try {
      await api.removeFavorite(chatId);
      set({ lastFavoritesFetchAt: Date.now() });
    } catch {
      set({ favoriteChatIds: prev });
      if (uid) saveFavoritesToStorage(uid, prev);
      get().setNotification('Не удалось убрать из избранного');
    }
  },

  toggleFavorite: async (chatId) => {
    const ids = get().favoriteChatIds;
    if (Array.isArray(ids) && ids.includes(chatId)) await get().removeFavorite(chatId);
    else await get().addFavorite(chatId);
  },

  setReplyTo: (msg) => set({ replyTo: msg, editingMessage: null }),
  setEditingMessage: (msg) => set({ editingMessage: msg, replyTo: null }),

  connectWS: () => {
    const { ws: existing, wsReconnectTimer } = get();
    if (existing && existing.readyState === WebSocket.OPEN) return;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);

    api.getSessionWsQuery().then((query) => {
      if (!query) return;
      const wsBase = getWebSocketBase();
      if (!wsBase) return;
      const socket = new WebSocket(`${wsBase}/ws?${query}`);

      socket.onopen = () => {
        const wasLongDisconnect = wsDisconnectedAt !== null && (Date.now() - wsDisconnectedAt) > WS_LONG_DISCONNECT_MS;
        wsDisconnectedAt = null;
        set({ ws: socket, wsReconnectAttempt: 0 });
        if (wasLongDisconnect) {
          location.reload();
          return;
        }
        get().flushPendingMessages();
        const activeChatId = get().activeChatId;
        if (activeChatId) get().fetchMessages(activeChatId);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          get().handleWSMessage(data);
        } catch { /* ignore parse errors */ }
      };

      socket.onclose = () => {
        wsDisconnectedAt = Date.now();
        set({ ws: null });
        const attempt = get().wsReconnectAttempt;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        const timer = setTimeout(() => get().connectWS(), delay);
        set({ wsReconnectTimer: timer, wsReconnectAttempt: attempt + 1 });
      };

      socket.onerror = () => {
        socket.close();
      };

      set({ ws: socket });
    }).catch(() => { /* нет сессии или ошибка подписи — просто не подключаем WS */ });
  },

  flushPendingMessages: () => {
    const { pendingMessages, ws } = get();
    if (pendingMessages.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
    set({ pendingMessages: [] });
    for (const { chatId, content, opts } of pendingMessages) {
      try {
        ws.send(JSON.stringify({
          type: 'new_message',
          chat_id: chatId,
          content,
          content_type: opts?.contentType || 'text',
          file_url: opts?.fileUrl || '',
          file_name: opts?.fileName || '',
          file_size: opts?.fileSize || 0,
          reply_to_id: opts?.replyToId || '',
        }));
      } catch (e) {
        console.error('flushPendingMessages send error:', e);
      }
    }
  },

  disconnectWS: () => {
    const { ws, wsReconnectTimer } = get();
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (ws) ws.close();
    set({ ws: null, wsReconnectTimer: null, wsReconnectAttempt: 0 });
  },

  setCallSignalingHandler: (handler) => {
    const queue = get().callSignalingQueue;
    set({ callSignalingHandler: handler, callSignalingQueue: [] });
    if (handler && queue.length > 0) {
      queue.forEach((msg) => {
        try {
          handler(msg.type, msg.payload);
        } catch (e) {
          console.error('call signaling drain:', e);
        }
      });
    }
  },

  connectCallWS: async () => {
    const { callWs } = get();
    if (callWs && callWs.readyState === WebSocket.OPEN) return;
    let query: string | null = null;
    try {
      query = await api.getCallWsQuery();
    } catch (e) {
      console.error('getCallWsQuery:', e);
    }
    if (!query) {
      set({ callWs: null, pendingStartCall: null, callError: 'Не удалось подключиться к звонку. Обновите страницу и попробуйте снова.', callPeerId: null, callId: null });
      setTimeout(() => set({ callState: 'idle', callError: null }), 5000);
      return;
    }
    const wsBase = getWebSocketBase();
    if (!wsBase) {
      set({ callWs: null, pendingStartCall: null, callError: 'Не задан адрес сервера.', callPeerId: null, callId: null });
      setTimeout(() => set({ callState: 'idle', callError: null }), 5000);
      return;
    }
    const socket = new WebSocket(`${wsBase}/call/ws?${query}`);
    socket.onopen = () => {
      set({ callWs: socket });
      const { pendingStartCall } = get();
      if (pendingStartCall) {
        set({ pendingStartCall: null, callState: 'calling', callPeerId: pendingStartCall, callIsCaller: true });
        try {
          socket.send(JSON.stringify({ type: 'start_call', payload: { peer_id: pendingStartCall } }));
        } catch (e) {
          console.error('call start_call send:', e);
        }
      }
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        get().handleCallWSMessage(data);
      } catch { /* ignore */ }
    };
    socket.onclose = () => {
      const { pendingStartCall: stillPending, callConnectTimer } = get();
      if (callConnectTimer) {
        clearTimeout(callConnectTimer);
        set({ callConnectDeadline: null, callConnectTimer: null });
      }
      set({ callWs: null });
      if (stillPending) {
        set({
          pendingStartCall: null,
          callError: 'Соединение с сервером звонков прервано. Убедитесь, что у обоих открыт чат и только одна вкладка. Попробуйте ещё раз.',
          callPeerId: null,
          callId: null,
        });
        setTimeout(() => set({ callState: 'idle', callError: null }), 5000);
      }
    };
    socket.onerror = () => socket.close();
  },

  startCall: (peerId) => {
    const clearConnectTimeout = () => {
      const { callConnectTimer } = get();
      if (callConnectTimer) {
        clearTimeout(callConnectTimer);
        set({ callConnectDeadline: null, callConnectTimer: null });
      }
    };
    const startConnectTimeout = () => {
      clearConnectTimeout();
      const deadline = Date.now() + CALL_CONNECT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        const s = get();
        if (s.callState !== 'calling' || s.callId) return;
        clearConnectTimeout();
        set({ callState: 'idle', callId: null, callPeerId: null, callFromUserId: null, callStartTime: null, callConnectDeadline: null, callConnectTimer: null });
        set({ callError: 'Время ожидания соединения истекло (30 сек).' });
        setTimeout(() => set({ callState: 'idle', callError: null }), 5000);
      }, CALL_CONNECT_TIMEOUT_MS);
      set({ callConnectDeadline: deadline, callConnectTimer: timer });
    };

    const { callWs } = get();
    if (callWs && callWs.readyState === WebSocket.OPEN) {
      set({ callState: 'calling', callPeerId: peerId, callId: null, callIsCaller: true, callError: null });
      startConnectTimeout();
      try {
        callWs.send(JSON.stringify({ type: 'start_call', payload: { peer_id: peerId } }));
      } catch (e) {
        console.error('call start_call send:', e);
      }
      return;
    }
    set({ pendingStartCall: peerId, callState: 'calling', callPeerId: peerId, callId: null, callIsCaller: true, callError: null });
    startConnectTimeout();
    get().connectCallWS();
  },

  acceptCall: (callId) => {
    const { callWs } = get();
    if (!callWs || callWs.readyState !== WebSocket.OPEN) return;
    try {
      callWs.send(JSON.stringify({ type: 'accept_call', payload: { call_id: callId } }));
      set({ callState: 'in_call', callId, callPeerId: get().callFromUserId, callFromUserId: null, callStartTime: Date.now(), callIsCaller: false });
    } catch (e) {
      console.error('call accept send:', e);
    }
  },

  rejectCall: (callId) => {
    const { callWs } = get();
    if (callWs && callWs.readyState === WebSocket.OPEN) {
      try {
        callWs.send(JSON.stringify({ type: 'reject_call', payload: { call_id: callId } }));
      } catch { /* */ }
    }
    set({ callState: 'idle', callId: null, callFromUserId: null, callPeerId: null, callSignalingQueue: [] });
  },

  hangupCall: () => {
    const { callWs, callId, callConnectTimer } = get();
    if (callConnectTimer) {
      clearTimeout(callConnectTimer);
      set({ callConnectDeadline: null, callConnectTimer: null });
    }
    if (callWs && callWs.readyState === WebSocket.OPEN && callId) {
      try {
        callWs.send(JSON.stringify({ type: 'hangup', payload: { call_id: callId } }));
      } catch { /* */ }
    }
    set({ callState: 'idle', callId: null, callPeerId: null, callFromUserId: null, callStartTime: null, callError: null, callSignalingQueue: [] });
  },

  handleCallWSMessage: (data: { type: string; payload: any }) => {
    const { type, payload } = data;
    const handler = get().callSignalingHandler;
    if (type === 'incoming_call') {
      const callId = payload?.call_id ?? '';
      const fromUserId = payload?.from_user_id ?? '';
      set({ callState: 'ringing', callId, callFromUserId: fromUserId, callPeerId: fromUserId });
      return;
    }
    if (type === 'call_started') {
      const { callConnectTimer } = get();
      if (callConnectTimer) {
        clearTimeout(callConnectTimer);
        set({ callConnectDeadline: null, callConnectTimer: null });
      }
      const callId = payload?.call_id ?? '';
      set({ callId });
      return;
    }
    if (type === 'call_accepted') {
      set((s) => ({ callState: 'in_call', callStartTime: s.callStartTime ?? Date.now() }));
      return;
    }
    if (type === 'call_rejected' || type === 'hangup') {
      set({ callState: 'idle', callId: null, callPeerId: null, callFromUserId: null, callStartTime: null, callSignalingQueue: [] });
      return;
    }
    if (type === 'call_error' || type === 'error') {
      set({ callError: payload?.error ?? 'Ошибка звонка', callPeerId: null, callId: null, callFromUserId: null, callSignalingQueue: [] });
      setTimeout(() => set({ callState: 'idle', callError: null }), 4000);
      return;
    }
    if (type === 'offer' || type === 'answer' || type === 'ice') {
      if (handler) {
        handler(type, payload);
      } else {
        set((s) => ({ callSignalingQueue: [...s.callSignalingQueue, { type, payload }] }));
      }
    }
  },

  createPersonalChat: async (userId) => {
    const chat = await api.createPersonalChat(userId);
    get().invalidateChatsCache();
    set((s) => {
      const exists = s.chats.some((c) => c.chat.id === chat.chat.id);
      if (exists) return {};
      return { chats: [chat, ...s.chats] };
    });
    return chat;
  },

  createGroupChat: async (name, memberIds) => {
    const chat = await api.createGroupChat(name, memberIds);
    get().invalidateChatsCache();
    set((s) => ({ chats: [chat, ...s.chats] }));
    return chat;
  },

  searchUsers: (query) => api.searchUsers(query),
  searchMessages: (query, chatId) => api.searchMessages(query, 30, chatId),
  uploadFile: async (file) => {
    try {
      return await api.uploadFile(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('file too large') || msg.toLowerCase().includes('too large')) {
        get().setNotification('Файл не получится загрузить: стоит ограничение по размеру.');
      }
      throw e;
    }
  },
  uploadVoice: async (file) => {
    try {
      return await api.uploadAudio(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('file too large') || msg.toLowerCase().includes('too large')) {
        get().setNotification('Файл не получится загрузить: стоит ограничение по размеру.');
      }
      throw e;
    }
  },

  addOptimisticVoiceMessage: (chatId) => {
    const user = useAuthStore.getState().user;
    const optId = `opt-voice-${Date.now()}`;
    const now = new Date().toISOString();
    const optimistic: Message = {
      id: optId,
      chat_id: chatId,
      sender_id: user?.id ?? '',
      content: 'Голосовое сообщение',
      content_type: 'voice',
      file_url: '',
      file_name: '',
      file_size: 0,
      status: 'sent',
      is_deleted: false,
      created_at: now,
      sender: user ? { ...user, is_online: true, last_seen_at: now } : undefined,
      reply_to_id: get().replyTo?.id,
      reply_to: get().replyTo ?? undefined,
    };
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] || []), optimistic],
      },
    }));
    return optId;
  },

  removeOptimisticMessage: (chatId, optId) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] || []).filter((m) => m.id !== optId),
      },
    }));
  },

  updateOptimisticVoiceMessage: (chatId, optId, opts) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] || []).map((m) =>
          m.id === optId ? { ...m, file_url: opts.fileUrl, file_name: opts.fileName ?? m.file_name, file_size: opts.fileSize ?? m.file_size } : m
        ),
      },
    }));
  },

  sendMessageWsOnly: (chatId, content, opts) => {
    const { ws, replyTo } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({
        type: 'new_message',
        chat_id: chatId,
        content,
        content_type: opts?.contentType || 'text',
        file_url: opts?.fileUrl || '',
        file_name: opts?.fileName || '',
        file_size: opts?.fileSize || 0,
        reply_to_id: opts?.replyToId || replyTo?.id || '',
      }));
    } catch (e) {
      console.error('ws send error:', e);
    }
  },

  leaveChat: async (chatId) => {
    await api.leaveChat(chatId);
    set((s) => ({
      chats: s.chats.filter((c) => c.chat.id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
    }));
  },

  handleWSMessage: (data) => {
    const { type, payload } = data;
    const myId = useAuthStore.getState().user?.id;

    switch (type) {
      case 'new_message': {
        const msg = normalizeMessageFileName(payload as Message);
        const fromMe = msg.sender_id === myId;
        set((s) => {
          const chatMsgs = s.messages[msg.chat_id] || [];
          let nextList: Message[];
          if (fromMe) {
            const alreadyExists = chatMsgs.some((m) => m.id === msg.id);
            if (alreadyExists) {
              nextList = chatMsgs;
            } else {
              const isVoice = msg.content_type === 'voice';
              let idx = chatMsgs.findIndex((m) => m.id.startsWith('opt-pending-'));
              if (idx < 0) {
                idx = chatMsgs.findIndex((m) => {
                  if (!m.id.startsWith('opt-')) return false;
                  if (isVoice) return m.id.startsWith('opt-voice-');
                  return !m.id.startsWith('opt-voice-');
                });
              }
              if (idx >= 0) {
                const out = [...chatMsgs];
                out[idx] = msg;
                nextList = out;
              } else {
                nextList = [...chatMsgs, msg];
              }
            }
          } else {
            const exists = chatMsgs.some((m) => m.id === msg.id);
            nextList = exists ? chatMsgs : [...chatMsgs, msg];
            nextList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          }
          const newMessages = { ...s.messages, [msg.chat_id]: nextList };

          let newChats = s.chats.map((c) => {
            if (c.chat.id !== msg.chat_id) return c;
            return {
              ...c,
              last_message: msg,
              unread_count: s.activeChatId === msg.chat_id ? c.unread_count : c.unread_count + 1,
            };
          });

          if (!newChats.some((c) => c.chat.id === msg.chat_id)) {
            get().invalidateChatsCache();
            get().fetchChats();
          }

          newChats.sort((a, b) => {
            const at = a.last_message?.created_at || a.chat.created_at;
            const bt = b.last_message?.created_at || b.chat.created_at;
            return new Date(bt).getTime() - new Date(at).getTime();
          });

          const typingArr = (s.typingUsers[msg.chat_id] || []).filter((id) => id !== msg.sender_id);

          return {
            messages: newMessages,
            chats: newChats,
            typingUsers: { ...s.typingUsers, [msg.chat_id]: typingArr },
          };
        });

        get().updateElectronBadge();

        const { activeChatId } = get();
        if (activeChatId === msg.chat_id && msg.sender_id !== myId) {
          get().markAsRead(msg.chat_id);
        }

        if (!fromMe && typeof document !== 'undefined' && (document.hidden || activeChatId !== msg.chat_id)) {
          const chat = get().chats.find((c) => c.chat.id === msg.chat_id);
          const chatTitle = chat
            ? (chat.chat.chat_type === 'group' || chat.chat.chat_type === 'notes'
              ? chat.chat.name
              : chat.members.find((m) => m.id !== myId)?.username || 'Чат')
            : msg.sender?.username || 'Чат';
          const body =
            msg.content_type === 'text'
              ? (msg.content || '').trim().slice(0, 120) || '—'
              : msg.content_type === 'voice'
                ? 'Голосовое сообщение'
                : (msg.file_name || 'Файл').trim().slice(0, 80);
          const electronApi = (window as unknown as { electronAPI?: { showNotification?: (opts: { title: string; body: string }) => void } }).electronAPI;
          if (electronApi?.showNotification) {
            electronApi.showNotification({ title: chatTitle, body });
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const n = new Notification(chatTitle, { body });
            n.onclick = () => {
              window.focus();
              n.close();
            };
          }
        }
        break;
      }

      case 'message_edited': {
        const { message_id, chat_id, content, edited_at } = payload;
        set((s) => {
          const msgs = s.messages[chat_id];
          if (!msgs) return {};
          return {
            messages: {
              ...s.messages,
              [chat_id]: msgs.map((m) =>
                m.id === message_id ? { ...m, content, edited_at, is_deleted: false } : m
              ),
            },
          };
        });
        break;
      }

      case 'message_deleted': {
        const { message_id, chat_id } = payload;
        set((s) => {
          const msgs = s.messages[chat_id];
          if (!msgs) return {};
          return {
            messages: {
              ...s.messages,
              [chat_id]: msgs.map((m) =>
                m.id === message_id ? { ...m, is_deleted: true, content: '' } : m
              ),
            },
          };
        });
        break;
      }

      case 'reaction_added': {
        const { message_id, chat_id, user_id, emoji } = payload;
        set((s) => {
          const msgs = s.messages[chat_id];
          if (!msgs) return {};
          return {
            messages: {
              ...s.messages,
              [chat_id]: msgs.map((m) => {
                if (m.id !== message_id) return m;
                const reactions = [...(m.reactions || [])];
                if (!reactions.some((r) => r.user_id === user_id && r.emoji === emoji)) {
                  reactions.push({ message_id, user_id, emoji, created_at: new Date().toISOString() });
                }
                return { ...m, reactions };
              }),
            },
          };
        });
        break;
      }

      case 'reaction_removed': {
        const { message_id, chat_id, user_id, emoji } = payload;
        set((s) => {
          const msgs = s.messages[chat_id];
          if (!msgs) return {};
          return {
            messages: {
              ...s.messages,
              [chat_id]: msgs.map((m) => {
                if (m.id !== message_id) return m;
                return { ...m, reactions: (m.reactions || []).filter((r) => !(r.user_id === user_id && r.emoji === emoji)) };
              }),
            },
          };
        });
        break;
      }

      case 'message_pinned': {
        const { chat_id } = payload;
        get().fetchPinnedMessages(chat_id);
        break;
      }

      case 'message_unpinned': {
        const { chat_id, message_id } = payload;
        set((s) => ({
          pinnedMessages: {
            ...s.pinnedMessages,
            [chat_id]: (s.pinnedMessages[chat_id] || []).filter((p) => p.message_id !== message_id),
          },
        }));
        break;
      }

      case 'chat_created': {
        const chatData = payload as ChatWithLastMessage;
        get().invalidateChatsCache();
        set((s) => {
          if (s.chats.some((c) => c.chat.id === chatData.chat.id)) return {};
          return { chats: [chatData, ...s.chats] };
        });
        break;
      }

      case 'chat_updated': {
        const { chat_id, name, description, avatar_url } = payload;
        set((s) => ({
          chats: s.chats.map((c) =>
            c.chat.id === chat_id
              ? { ...c, chat: { ...c.chat, name, description, ...(avatar_url !== undefined && { avatar_url }) } }
              : c
          ),
        }));
        break;
      }

      case 'member_added': {
        const { chat_id, user_id, username, actor_name } = payload;
        const text = actor_name
          ? `${actor_name} добавил(а) ${username} в группу`
          : `Пользователь ${username} добавлен в группу`;
        set((s) => ({ notification: text }));
        // Если добавили текущего пользователя — обновляем список чатов и предзагружаем историю сообщений
        if (user_id === myId) {
          get().fetchChats().then(() => {
            get().fetchMessages(chat_id);
          });
        } else {
          api.getChat(chat_id).then((chat) => {
            set((s) => ({
              chats: s.chats.map((c) => c.chat.id === chat_id ? chat : c),
            }));
          }).catch(() => {});
        }
        break;
      }
      case 'member_removed': {
        const { chat_id, user_id, username, is_leave, actor_name } = payload;
        const text = is_leave
          ? `${username} покинул(а) группу`
          : actor_name
            ? `${actor_name} исключил(а) ${username} из группы`
            : `Пользователь ${username} исключён из группы`;
        set((s) => ({ notification: text }));
        // Если исключили текущего пользователя — обновляем список и выходим из этого чата
        if (user_id === myId) {
          set((s) => ({
            chats: s.chats.filter((c) => c.chat.id !== chat_id),
            activeChatId: s.activeChatId === chat_id ? null : s.activeChatId,
          }));
        } else {
          api.getChat(chat_id).then((chat) => {
            set((s) => ({
              chats: s.chats.map((c) => c.chat.id === chat_id ? chat : c),
            }));
          }).catch(() => {});
        }
        break;
      }

      case 'typing': {
        const { chat_id, user_id } = payload as { chat_id: string; user_id: string };
        if (user_id === myId) break;

        const key = `${chat_id}:${user_id}`;
        if (typingClearTimeouts[key]) clearTimeout(typingClearTimeouts[key]);

        set((s) => {
          const current = s.typingUsers[chat_id] || [];
          if (current.includes(user_id)) return {};
          return { typingUsers: { ...s.typingUsers, [chat_id]: [...current, user_id] } };
        });

        typingClearTimeouts[key] = setTimeout(() => {
          delete typingClearTimeouts[key];
          set((s) => ({
            typingUsers: {
              ...s.typingUsers,
              [chat_id]: (s.typingUsers[chat_id] || []).filter((id) => id !== user_id),
            },
          }));
        }, 3000);
        break;
      }

      case 'message_read': {
        const { chat_id } = payload as { chat_id: string };
        set((s) => {
          const msgs = s.messages[chat_id];
          if (!msgs) return {};
          return {
            messages: {
              ...s.messages,
              [chat_id]: msgs.map((m) => (m.sender_id === myId ? { ...m, status: 'read' as const } : m)),
            },
          };
        });
        break;
      }

      case 'user_online':
      case 'user_offline': {
        const { user_id, online } = payload as { user_id: string; online: boolean };
        set((s) => ({
          onlineUsers: { ...s.onlineUsers, [user_id]: online },
          chats: s.chats.map((c) => ({
            ...c,
            members: c.members.map((m) => (m.id === user_id ? { ...m, is_online: online } : m)),
          })),
        }));
        break;
      }
    }
  },

  reset: () => {
    const { ws, wsReconnectTimer, callWs } = get();
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (ws) ws.close();
    if (callWs) callWs.close();
    set(initialChatState);
    get().updateElectronBadge();
  },
}));
