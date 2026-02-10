import type { ChatWithLastMessage, Message, UserPublic, UserStats, FileUploadResponse, PinnedMessage, Reaction } from './types';
import { getApiBase } from './serverUrl';

/** Префикс API-маршрутов; должен совпадать с маршрутами на бэкенде (path = r.URL.Path). */
const API = '/api';

function getApiRoot(): string {
  return getApiBase() + API;
}

/** Ошибка API с кодом ответа (401 = не авторизован, сессия недействительна). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const SESSION_ID_KEY = 'session_id';
const SESSION_SECRET_KEY = 'session_secret';

function getSessionId(): string | null {
  return localStorage.getItem(SESSION_ID_KEY);
}

function getSessionSecret(): string | null {
  return localStorage.getItem(SESSION_SECRET_KEY);
}

/** HMAC-SHA256(secret, method+path+body+timestamp), результат в hex (как на бэкенде). */
async function signSessionPayload(
  secretBase64: string,
  method: string,
  path: string,
  body: string,
  timestamp: string
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = method + path + body + timestamp;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getSessionAuthHeaders(method: string, path: string, body: string): Promise<Record<string, string> | null> {
  const sessionId = getSessionId();
  const sessionSecret = getSessionSecret();
  if (!sessionId || !sessionSecret) return null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signSessionPayload(sessionSecret, method, path, body, timestamp);
  return {
    'X-Session-Id': sessionId,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  };
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const method = opts?.method ?? 'GET';
  const bodyStr = opts?.body != null && !(opts.body instanceof FormData) ? String(opts.body) : '';
  const headers: Record<string, string> = {};
  if (opts?.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  // Путь для подписи = r.URL.Path на сервере: только pathname с префиксом /api, без query.
  const pathname = path.includes('?') ? path.slice(0, path.indexOf('?')) : path;
  const pathForSignature = `${API}${pathname}`;
  const pathForFetch = `${getApiRoot()}${path}`;
  const sessionHeaders = await getSessionAuthHeaders(method, pathForSignature, bodyStr);
  if (sessionHeaders) Object.assign(headers, sessionHeaders);

  const res = await fetch(pathForFetch, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string>) } });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const msg = data.error || `HTTP ${res.status}`;
    const friendly = res.status === 500 ? 'Ошибка сервера. Попробуйте позже.' : msg;
    if (res.status === 500 && msg !== friendly) console.error('API 500:', msg);
    throw new ApiError(friendly, res.status);
  }
  return res.json();
}

/** Публичный запрос без токена (для конфига кеша и т.п.) */
async function requestPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiRoot()}${path}`);
  const text = await res.text();
  if (!res.ok) return Promise.reject(new Error(`HTTP ${res.status}`));
  try {
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return Promise.reject(new Error('Invalid response'));
  }
}

// Config (public)
export const getCacheConfig = () =>
  requestPublic<{ ttl_minutes: number }>('/config/cache');

export interface PushConfig {
  enabled: boolean;
  vapid_public_key?: string;
}
export const getPushConfig = () =>
  requestPublic<PushConfig>('/config/push');

export interface CallConfig {
  ice_servers?: RTCIceServer[];
}
export const getCallConfig = () =>
  requestPublic<CallConfig>('/config/call');

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}
export interface PushSubscriptionJson {
  endpoint: string;
  keys: PushSubscriptionKeys;
}
export const pushSubscribe = (subscription: PushSubscriptionJson) =>
  request<void>('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
export const pushUnsubscribe = (endpoint: string) =>
  request<void>('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });

// Auth (passwordless: email → OTP → session)
export interface VerifyCodeResponse {
  session_id: string;
  session_secret: string;
  is_new_user: boolean;
}

/** UUID v4: использует randomUUID или fallback через getRandomValues (для старых браузеров / без HTTPS). */
function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getDeviceId(): string {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
}

export const requestCode = (email: string) =>
  fetch(`${getApiRoot()}/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
  });

export const verifyCode = (email: string, code: string, deviceName?: string): Promise<VerifyCodeResponse> =>
  fetch(`${getApiRoot()}/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      code: code.trim(),
      device_id: getDeviceId(),
      device_name: deviceName ?? 'Web',
    }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as VerifyCodeResponse;
  });

/** Query string для WebSocket /ws с подписью сессии (session_id, timestamp, signature). */
export async function getSessionWsQuery(): Promise<string | null> {
  const sessionId = getSessionId();
  const sessionSecret = getSessionSecret();
  if (!sessionId || !sessionSecret) return null;
  const path = '/ws';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signSessionPayload(sessionSecret, 'GET', path, '', timestamp);
  return `session_id=${encodeURIComponent(sessionId)}&timestamp=${encodeURIComponent(timestamp)}&signature=${encodeURIComponent(signature)}`;
}

/** Query string для WebSocket /call/ws (сигнализация звонков). */
export async function getCallWsQuery(): Promise<string | null> {
  const sessionId = getSessionId();
  const sessionSecret = getSessionSecret();
  if (!sessionId || !sessionSecret) return null;
  const path = '/call/ws';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signSessionPayload(sessionSecret, 'GET', path, '', timestamp);
  return `session_id=${encodeURIComponent(sessionId)}&timestamp=${encodeURIComponent(timestamp)}&signature=${encodeURIComponent(signature)}&path=${encodeURIComponent(path)}`;
}

// Users
export const getMe = () => request<UserPublic>('/users/me');
export const getUser = (id: string) => request<UserPublic>(`/users/${id}`);
export const getUserStats = (id: string) => request<UserStats>(`/users/${id}/stats`);

export interface UserPermissions {
  user_id: string;
  administrator: boolean;
  member: boolean;
  admin_all_groups: boolean;
  delete_others_messages: boolean;
  manage_bots: boolean;
  edit_others_profile: boolean;
  invite_to_team: boolean;
  remove_from_team: boolean;
  updated_at?: string;
}
export const getUserPermissions = (userId: string) =>
  request<UserPermissions>(`/users/${userId}/permissions`);
export const updateUserPermissions = (userId: string, data: Partial<Record<keyof Omit<UserPermissions, 'user_id' | 'updated_at'>, boolean>>) =>
  request<UserPermissions>(`/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify(data) });
export const listUsers = () => request<UserPublic[]>('/users');
/** Список всех сотрудников (только для администратора). */
export const listEmployees = () => request<UserPublic[]>('/users/employees');
/** Создать пользователя (админ). При первом входе по этой почте это будет его профиль. */
export const createUser = (data: {
  email: string;
  username: string;
  phone?: string;
  avatar_url?: string;
  permissions?: Partial<Record<keyof Omit<UserPermissions, 'user_id' | 'updated_at'>, boolean>>;
}) => request<UserPublic>('/users', { method: 'POST', body: JSON.stringify(data) });
export const searchUsers = (q: string) => request<UserPublic[]>(`/users/search?q=${encodeURIComponent(q)}`);
export const updateProfile = (data: { username?: string; avatar_url?: string; email?: string; phone?: string }) =>
  request<UserPublic>('/users/me', { method: 'PUT', body: JSON.stringify(data) });
export const updateUserProfile = (userId: string, data: { username?: string; avatar_url?: string; email?: string; phone?: string }) =>
  request<UserPublic>(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) });
/** Отключить или включить пользователя (только администратор). Отключённый не может войти. */
export const setUserDisabled = (userId: string, disabled: boolean) =>
  request<{ disabled: boolean }>(`/users/${userId}/disable`, { method: 'PUT', body: JSON.stringify({ disabled }) });
export const getFavorites = () =>
  request<{ chat_ids: string[] }>('/users/me/favorites').then((r) => r.chat_ids);
export const addFavorite = (chatId: string) =>
  request<unknown>('/users/me/favorites', { method: 'POST', body: JSON.stringify({ chat_id: chatId }) });
export const removeFavorite = (chatId: string) =>
  request<unknown>(`/users/me/favorites/${chatId}`, { method: 'DELETE' });

// Chats
export const getChats = () => request<ChatWithLastMessage[]>('/chats');
export const getChat = (id: string) => request<ChatWithLastMessage>(`/chats/${id}`);
export const createPersonalChat = (userId: string) =>
  request<ChatWithLastMessage>('/chats/personal', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
export const createGroupChat = (name: string, memberIds: string[]) =>
  request<ChatWithLastMessage>('/chats/group', { method: 'POST', body: JSON.stringify({ name, member_ids: memberIds }) });
export const updateChat = (id: string, data: { name?: string; description?: string; avatar_url?: string }) =>
  request<unknown>(`/chats/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const addMembers = (chatId: string, memberIds: string[]) =>
  request<unknown>(`/chats/${chatId}/members`, { method: 'POST', body: JSON.stringify({ member_ids: memberIds }) });
export const removeMember = (chatId: string, memberId: string) =>
  request<unknown>(`/chats/${chatId}/members/${memberId}`, { method: 'DELETE' });
export const leaveChat = (chatId: string) =>
  request<unknown>(`/chats/${chatId}/leave`, { method: 'POST' });

// Messages
export const getMessages = (chatId: string, limit = 50, offset = 0) =>
  request<Message[]>(`/chats/${chatId}/messages?limit=${limit}&offset=${offset}`);
export const markAsRead = (chatId: string) =>
  request<unknown>(`/chats/${chatId}/read`, { method: 'POST' });
export const searchMessages = (q: string, limit = 30, chatId?: string) => {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (chatId) params.set('chat_id', chatId);
  return request<Message[]>(`/messages/search?${params.toString()}`);
};
export const getPinnedMessages = (chatId: string) =>
  request<PinnedMessage[]>(`/chats/${chatId}/pinned`);
export const getReactions = (messageId: string) =>
  request<Reaction[]>(`/messages/${messageId}/reactions`);

// Files
export const uploadFile = async (file: File): Promise<FileUploadResponse> => {
  const fd = new FormData();
  fd.append('file', file);
  return request<FileUploadResponse>('/files/upload', { method: 'POST', body: fd });
};

// Voice (audio messages — отдельный микросервис)
export const uploadAudio = async (file: File): Promise<FileUploadResponse> => {
  const fd = new FormData();
  fd.append('file', file);
  return request<FileUploadResponse>('/audio/upload', { method: 'POST', body: fd });
};
