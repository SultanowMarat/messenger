/**
 * Адрес сервера приложения (API, WebSocket, Auth).
 * Сохраняется в localStorage; при смене сервера все запросы идут по новому адресу.
 */

const STORAGE_KEY = 'server_url';

function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  let withProtocol = u;
  if (!/^https?:\/\//i.test(u)) withProtocol = `https://${u}`;
  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

/** Текущий базовый URL (без завершающего слэша). По умолчанию — origin страницы. */
export function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored.trim()) {
    const n = normalizeUrl(stored);
    if (n) return n;
  }
  return window.location.origin;
}

/** Сохранить адрес сервера (нормализованный). */
export function setServerUrl(url: string): void {
  const n = normalizeUrl(url);
  if (typeof window !== 'undefined') {
    if (n) localStorage.setItem(STORAGE_KEY, n);
    else localStorage.removeItem(STORAGE_KEY);
  }
}

/** Получить сохранённое значение (сырое), без нормализации. */
export function getStoredServerUrl(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) || '';
}

/** URL для WebSocket: wss://host или ws://host (без path). */
export function getWebSocketBase(): string {
  const base = getApiBase();
  if (!base) return '';
  try {
    const u = new URL(base);
    return u.protocol === 'https:' ? `wss://${u.host}` : `ws://${u.host}`;
  } catch {
    return '';
  }
}

/** Проверить, доступен ли адрес (HEAD или GET /health). */
export async function checkServerReachable(url: string): Promise<boolean> {
  const base = normalizeUrl(url);
  if (!base) return false;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(base, { method: 'GET', signal: controller.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }
}
