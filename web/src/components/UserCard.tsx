import { useState, useEffect, useCallback } from 'react';
import { Avatar, IconX, IconPhone, IconUser, IconMail as IconMailUi } from './ui';
import type { UserStats, UserPublic } from '../types';
import * as api from '../api';
import { useAuthStore, useChatStore } from '../store';

interface Props {
  userId: string;
  onClose: () => void;
  onOpenChat?: (userId: string) => void;
}

/* ── Helpers ── */
function formatLastSeen(iso: string): string {
  if (!iso) return 'Неизвестно';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatResponseTime(sec: number): string {
  if (sec <= 0) return '—';
  if (sec < 60) return `~${Math.round(sec)} сек.`;
  const m = Math.round(sec / 60);
  if (m < 60) return `~${m} мин.`;
  const h = Math.round(m / 60);
  return `~${h} ч.`;
}

/* ── Icons ── */
function IconMail({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}
function IconClock({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IconActivity({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function IconHeart({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}
function IconMessageCircleFilled({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
function IconDotsH({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}
function IconSliders({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}
function IconBell({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
function IconPencil({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function IconTrash({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
function IconUserMinus({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}

/* ── Validation for edit form ── */
const PHONE_RE = /^\+\d{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validatePhone(v: string): string {
  if (!v) return '';
  if (!v.startsWith('+')) return 'Номер должен начинаться с +';
  if (!PHONE_RE.test(v)) return 'Неверный формат номера (после + только цифры, 8–15 знаков)';
  return '';
}
function validateEmail(v: string): string {
  if (!v) return '';
  if (!EMAIL_RE.test(v)) return 'Некорректный формат email';
  return '';
}

const PERMISSION_KEYS = {
  chats: ['administrator', 'member', 'admin_all_groups', 'delete_others_messages', 'manage_bots'] as const,
  participants: ['edit_others_profile', 'invite_to_team', 'remove_from_team'] as const,
} as const;
type PermissionId = typeof PERMISSION_KEYS.chats[number] | typeof PERMISSION_KEYS.participants[number];

const DEFAULT_PERMISSIONS: Record<PermissionId, boolean> = {
  administrator: false,
  member: true,
  admin_all_groups: false,
  delete_others_messages: false,
  manage_bots: false,
  edit_others_profile: false,
  invite_to_team: false,
  remove_from_team: false,
};

const PERMISSIONS_STORAGE_KEY = 'messenger:user_permissions';

function loadStoredPermissions(userId: string): Record<PermissionId, boolean> {
  try {
    const raw = localStorage.getItem(`${PERMISSIONS_STORAGE_KEY}:${userId}`);
    if (!raw) return { ...DEFAULT_PERMISSIONS };
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...DEFAULT_PERMISSIONS, ...parsed };
  } catch {
    return { ...DEFAULT_PERMISSIONS };
  }
}

function saveStoredPermissions(userId: string, permissions: Record<PermissionId, boolean>): void {
  try {
    localStorage.setItem(`${PERMISSIONS_STORAGE_KEY}:${userId}`, JSON.stringify(permissions));
  } catch {
    // ignore quota etc.
  }
}

export default function UserCard({ userId, onClose, onOpenChat }: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const setNotification = useChatStore((s) => s.setNotification);
  const [data, setData] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissions, setPermissions] = useState<Record<PermissionId, boolean>>(DEFAULT_PERMISSIONS);
  const [myAdministrator, setMyAdministrator] = useState(false);
  const canEditProfile = currentUser?.id === userId || myAdministrator;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getUserStats(userId).then((res) => {
      if (!cancelled) { setData(res); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    const meId = currentUser?.id;
    if (!meId) return;
    let cancelled = false;
    api.getUserPermissions(meId)
      .then((res) => {
        if (!cancelled) setMyAdministrator(res.administrator);
      })
      .catch(() => { if (!cancelled) setMyAdministrator(false); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!permissionsOpen || !userId) return;
    let cancelled = false;
    api.getUserPermissions(userId)
      .then((res) => {
        if (cancelled) return;
        setPermissions({
          administrator: res.administrator,
          member: res.member ?? true,
          admin_all_groups: res.admin_all_groups,
          delete_others_messages: res.delete_others_messages,
          manage_bots: res.manage_bots,
          edit_others_profile: res.edit_others_profile,
          invite_to_team: res.invite_to_team,
          remove_from_team: res.remove_from_team,
        });
      })
      .catch(() => {
        if (!cancelled) setPermissions(loadStoredPermissions(userId));
      });
    return () => { cancelled = true; };
  }, [permissionsOpen, userId]);

  const u = data?.user;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 safe-area-padding min-h-[100dvh]">
      <div className="absolute inset-0 bg-[rgba(4,4,10,0.55)] dark:bg-black/60" onClick={onClose} />
      <div className="relative bg-white dark:bg-dark-elevated rounded-[16px] shadow-compass-dialog w-full max-w-[400px] max-h-[90dvh] overflow-y-auto animate-dialog border border-transparent dark:border-dark-border">
        {/* Кнопки: редактировать профиль, закрыть (настройки прав — в меню «ещё») */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {canEditProfile && (
            <button
              onClick={() => setEditFormOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 text-txt dark:text-white transition-colors"
              title="Редактировать профиль"
              aria-label="Редактировать профиль"
            >
              <IconPencil size={14} />
            </button>
          )}
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 text-white dark:text-txt transition-colors"
            aria-label="Закрыть">
            <IconX size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : u ? (
          <>
            {/* Header: Avatar + Name + Status */}
            <div className="flex flex-col items-center pt-8 pb-5 bg-gradient-to-b from-primary/5 to-transparent dark:from-transparent dark:to-transparent">
              <Avatar name={u.username} url={u.avatar_url || undefined} size={96} online={u.is_online} />
              <h2 className="mt-3 text-[20px] font-bold text-txt dark:text-[#e7e9ea]">{u.username}</h2>
              <p className={`text-[13px] font-medium mt-0.5 ${u.is_online ? 'text-green' : 'text-txt-secondary dark:text-[#8b98a5]'}`}>
                {u.is_online ? 'Сейчас онлайн' : `Был(а) ${formatLastSeen(u.last_seen_at)}`}
              </p>
              {u.disabled_at && (
                <p className="text-[12px] font-medium mt-1 text-danger">Пользователь отключён</p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex justify-center gap-3 px-6 pb-4 -mt-1 relative">
              <ActionBtn icon={<IconMessageCircleFilled />} label="написать" onClick={() => { onOpenChat?.(userId); onClose(); }} />
              <ActionBtn icon={<IconPhone />} label="позвонить" onClick={() => {}} />
              <ActionBtn icon={<IconHeart />} label="спасибо" onClick={() => {}} />
              <div className="relative flex justify-end">
                <ActionBtn icon={<IconDotsH />} label="ещё" onClick={() => setMenuOpen((v) => !v)} />
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-0" aria-hidden onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-10 mt-2 w-[max(220px,min(280px,calc(100vw-2rem)))] max-w-[calc(100vw-2rem)] py-1 bg-[#2f3336] dark:bg-dark-hover rounded-lg shadow-lg border border-white/10 dark:border-dark-border">
                      <MenuBtn icon={<IconBell />} label="Отключить уведомления" onClick={() => { setMenuOpen(false); }} />
                      <MenuBtn icon={<IconPencil />} label="Очистить историю" onClick={() => { setMenuOpen(false); }} />
                      <MenuBtn icon={<IconTrash />} label="Удалить чат" onClick={() => { setMenuOpen(false); }} />
                      <MenuBtn icon={<IconSliders />} label="Настроить права в команде" onClick={() => { setMenuOpen(false); setPermissionsOpen(true); }} />
                      <MenuBtn icon={<IconUserMinus />} label="Удалить из команды" onClick={() => { setMenuOpen(false); }} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Contact info — поля как на макете: иконка слева, подпись сверху, значение снизу (Почта и Телефон по аналогии) */}
            <div className="mx-5 mb-3 flex flex-col gap-3">
              <ContactField icon={<IconMail size={20} />} label="Почта" value={u.email || '—'} />
              <ContactField icon={<IconPhone size={20} />} label="Телефон" value={u.phone || '—'} />
            </div>

            {/* Activity stats */}
            <div className="mx-5 mb-5 bg-surface dark:bg-dark-hover rounded-[12px] overflow-hidden divide-y divide-surface-border dark:divide-dark-border">
              <StatRow icon={<IconActivity />} label="Активность в день" value={String(data?.messages_today ?? 0)} />
              <StatRow icon={<IconActivity />} label="Действий за неделю" value={String(data?.messages_week ?? 0)} />
              <StatRow icon={<IconClock />} label="Последний раз в сети" value={u.is_online ? 'Сейчас' : formatLastSeen(u.last_seen_at)} />
              <StatRow icon={<IconClock />} label="Отвечает в течение" value={formatResponseTime(data?.avg_response_sec ?? 0)} />
            </div>

            {/* Администратор: отключить/включить пользователя (не себя) */}
            {myAdministrator && userId !== currentUser?.id && u && (
              <div className="mx-5 mb-5 p-4 rounded-[12px] bg-surface dark:bg-dark-hover border border-surface-border dark:border-dark-border">
                {u.disabled_at ? (
                  <>
                    <p className="text-[13px] text-danger font-medium mb-2">Пользователь отключён и не может войти в приложение.</p>
                    <button
                      type="button"
                      onClick={() => {
                        api.setUserDisabled(userId, false).then(() => {
                          setData((prev) => prev && prev.user ? { ...prev, user: { ...prev.user, disabled_at: undefined } } : prev);
                          setNotification('Пользователь включён');
                        }).catch(() => setNotification('Не удалось включить пользователя'));
                      }}
                      className="compass-btn-primary w-full py-2.5 text-[14px]"
                    >
                      Включить пользователя
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm('Отключить пользователя? Он не сможет войти в приложение до включения.')) return;
                      api.setUserDisabled(userId, true).then(() => {
                        setData((prev) => prev && prev.user ? { ...prev, user: { ...prev.user, disabled_at: new Date().toISOString() } } : prev);
                        setNotification('Пользователь отключён');
                      }).catch(() => setNotification('Не удалось отключить пользователя'));
                    }}
                    className="compass-btn-danger w-full py-2.5 text-[14px]"
                  >
                    Отключить пользователя
                  </button>
                )}
              </div>
            )}

            {editFormOpen && u && (
              <EditUserModal
                user={u}
                isSelf={userId === currentUser?.id}
                onSave={(updated) => {
                  setData((prev) => (prev ? { ...prev, user: updated } : null));
                  setEditFormOpen(false);
                }}
                onClose={() => setEditFormOpen(false)}
              />
            )}
            {permissionsOpen && u && (
              <PermissionsModal
                user={u}
                permissions={permissions}
                onPermissionsChange={(next) => {
                  setPermissions(next);
                  api.updateUserPermissions(userId, next).catch(() => {
                    saveStoredPermissions(userId, next);
                  });
                }}
                onClose={() => setPermissionsOpen(false)}
              />
            )}
          </>
        ) : (
          <div className="py-16 text-center text-txt-secondary dark:text-[#8b98a5] text-[14px]">Пользователь не найден</div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */
function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1.5 w-[80px] py-3 rounded-[12px] bg-[#f0f0f0] dark:bg-[#2f3336] hover:bg-[#e8e8e8] dark:hover:bg-white/10 transition-colors group border border-transparent dark:border-white/10">
      <span className="text-txt-secondary dark:text-[#8b98a5] group-hover:text-primary transition-colors">{icon}</span>
      <span className="text-[11px] font-medium text-txt-secondary dark:text-[#8b98a5] group-hover:text-txt dark:group-hover:text-[#e7e9ea] transition-colors">{label}</span>
    </button>
  );
}

function MenuBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[14px] text-white hover:bg-white/10 transition-colors">
      <span className="text-[#8b98a5] flex-shrink-0">{icon}</span>
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

/* Поле контакта в стиле макета: светлый скруглённый блок, иконка слева, подпись сверху, значение снизу */
function ContactField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-[12px] bg-[#f0f0f0] dark:bg-[#2f3336] border border-transparent dark:border-white/10">
      <span className="text-txt-secondary dark:text-[#8b98a5] flex-shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-txt-placeholder dark:text-[#8b98a5] mb-0.5">{label}</p>
        <p className="text-[14px] font-medium text-txt dark:text-[#e7e9ea] truncate">{value}</p>
      </div>
    </div>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="text-txt-secondary dark:text-[#8b98a5]">{icon}</span>
        <span className="text-[13px] text-txt dark:text-[#e7e9ea]">{label}</span>
      </div>
      <span className="text-[14px] font-bold text-txt dark:text-[#e7e9ea]">{value}</span>
    </div>
  );
}

/* Поле редактирования: иконка слева, подпись сверху, инпут */
function ProfileEditField(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    icon: React.ReactNode;
    label: string;
    error?: string;
    hint?: string;
  }
) {
  const { icon, label, error, hint, className, ...rest } = props;
  return (
    <div className="flex flex-col gap-1">
      <div className={`flex items-start gap-3 px-4 py-3 rounded-[12px] bg-[#f0f0f0] dark:bg-[#2f3336] border border-transparent dark:border-white/10 ${error ? 'ring-2 ring-danger/40' : ''}`}>
        <span className="text-txt-secondary dark:text-[#8b98a5] flex-shrink-0 mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-txt-placeholder dark:text-[#8b98a5] mb-1">{label}</p>
          <input
            className={`w-full bg-transparent text-[14px] font-medium text-txt dark:text-[#e7e9ea] placeholder:text-txt-placeholder dark:placeholder:text-[#8b98a5] focus:outline-none ${className ?? ''}`}
            {...rest}
          />
        </div>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {!error && hint && <p className="text-[11px] text-txt-placeholder dark:text-[#8b98a5]">{hint}</p>}
    </div>
  );
}

/* ─── Edit User Modal (форма редактирования данных пользователя) ─── */
interface EditUserModalProps {
  user: UserPublic;
  isSelf: boolean;
  onSave: (updated: UserPublic) => void;
  onClose: () => void;
}

function EditUserModal({ user, isSelf, onSave, onClose }: EditUserModalProps) {
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [emailErr, setEmailErr] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setEmail(v);
    setEmailErr(validateEmail(v));
    setSaveError('');
  }, []);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    v = v.replace(/[^\d+]/g, '');
    if (v.length > 0 && !v.startsWith('+')) v = '+' + v;
    if (v.length > 16) v = v.slice(0, 16);
    setPhone(v);
    setPhoneErr(validatePhone(v));
    setSaveError('');
  }, []);

  const hasErrors = !!emailErr || !!phoneErr;

  const handleSave = useCallback(async () => {
    if (!username.trim()) return;
    const eErr = validateEmail(email);
    const pErr = validatePhone(phone);
    setEmailErr(eErr);
    setPhoneErr(pErr);
    if (eErr || pErr) return;
    setSaving(true);
    setSaveError('');
    try {
      const data = { username: username.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined };
      const updated = isSelf
        ? await api.updateProfile(data)
        : await api.updateUserProfile(user.id, data);
      onSave(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [username, email, phone, isSelf, user.id, onSave]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 safe-area-padding">
      <div className="absolute inset-0 bg-black/65" onClick={onClose} />
      <div
        className="relative w-full max-w-[min(400px,calc(100vw-2rem))] flex flex-col rounded-[16px] shadow-xl overflow-hidden bg-white dark:bg-dark-elevated border border-transparent dark:border-dark-border animate-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 text-txt dark:text-white transition-colors"
          aria-label="Закрыть"
        >
          <IconX size={16} />
        </button>

        <div className="flex-shrink-0 pt-6 pb-2 px-5">
          <h3 className="text-[18px] font-bold text-txt dark:text-white">Редактирование профиля</h3>
          <p className="text-[13px] text-txt-secondary dark:text-[#8b98a5] mt-0.5">
            {isSelf ? 'Измените свои данные' : `Редактирование пользователя ${user.username}`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
          <ProfileEditField
            icon={<IconUser size={20} />}
            label="Имя"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Имя пользователя"
          />
          <ProfileEditField
            icon={<IconMailUi size={20} />}
            label="Почта"
            value={email}
            onChange={handleEmailChange}
            placeholder="user@example.com"
            type="email"
            error={emailErr}
          />
          <ProfileEditField
            icon={<IconPhone size={20} />}
            label="Телефон"
            value={phone}
            onChange={handlePhoneChange}
            placeholder="+7 999 123-45-67"
            type="tel"
            error={phoneErr}
            hint="Международный формат: + и цифры"
          />
          {saveError && <p className="text-[12px] text-danger">{saveError}</p>}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !username.trim() || hasErrors}
              className="flex-1 py-2.5 rounded-[12px] font-semibold text-[15px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-[12px] text-[14px] font-medium text-txt-secondary dark:text-[#8b98a5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Toggle (touch-friendly, min 44px) ─── */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 min-h-[44px] py-2 cursor-pointer select-none">
      <span className="text-[14px] text-white flex-1 min-w-0 break-words">{label}</span>
      <span className="shrink-0 relative w-11 h-6">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <span className="absolute inset-0 rounded-full bg-[#4a4e52] transition-colors peer-checked:bg-primary" />
        <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform pointer-events-none peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

/* ─── Permissions Modal (dark theme, responsive, PWA-safe) ─── */
interface PermissionsModalProps {
  user: { username: string; avatar_url?: string | null };
  permissions: Record<PermissionId, boolean>;
  onPermissionsChange: (p: Record<PermissionId, boolean>) => void;
  onClose: () => void;
}

const CHAT_PERMISSIONS: { id: PermissionId; label: string }[] = [
  { id: 'administrator', label: 'Администратор' },
  { id: 'member', label: 'Пользователь' },
  { id: 'admin_all_groups', label: 'Администратор во всех группах' },
  { id: 'delete_others_messages', label: 'Удаление чужих сообщений' },
  { id: 'manage_bots', label: 'Управление ботами' },
];
const PARTICIPANT_PERMISSIONS: { id: PermissionId; label: string }[] = [
  { id: 'edit_others_profile', label: 'Редактировать чужой профиль' },
  { id: 'invite_to_team', label: 'Приглашение в команду' },
  { id: 'remove_from_team', label: 'Удаление из команды' },
];

function PermissionsModal({ user, permissions, onPermissionsChange, onClose }: PermissionsModalProps) {
  const setOne = (id: PermissionId, value: boolean) => {
    onPermissionsChange({ ...permissions, [id]: value });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 safe-area-padding">
      <div className="absolute inset-0 bg-black/65" onClick={onClose} />
      <div
        className="relative w-full max-w-[min(400px,calc(100vw-2rem))] max-h-[min(85vh,600px)] flex flex-col rounded-[16px] shadow-xl overflow-hidden bg-[#1c1e21] border border-white/10 animate-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Закрыть"
        >
          <IconX size={16} />
        </button>

        <div className="flex-shrink-0 pt-5 pb-4 px-5 flex flex-col items-center text-center">
          <Avatar name={user.username} url={user.avatar_url || undefined} size={56} />
          <h3 className="mt-3 text-[18px] font-bold text-white truncate max-w-full">{user.username}</h3>
          <p className="text-[13px] text-[#8b98a5]">Пользователь Мессенджера</p>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 safe-y">
          <section className="pt-2">
            <h4 className="text-[15px] font-bold text-white mb-2">Чаты</h4>
            <div className="space-y-0 divide-y divide-white/10">
              {CHAT_PERMISSIONS.map(({ id, label }) => (
                <Toggle
                  key={id}
                  label={label}
                  checked={permissions[id]}
                  onChange={(v) => setOne(id, v)}
                />
              ))}
            </div>
          </section>

          <div className="border-t border-dashed border-white/20 my-4" />

          <section>
            <h4 className="text-[15px] font-bold text-white mb-2">Участники</h4>
            <div className="space-y-0 divide-y divide-white/10">
              {PARTICIPANT_PERMISSIONS.map(({ id, label }) => (
                <Toggle
                  key={id}
                  label={label}
                  checked={permissions[id]}
                  onChange={(v) => setOne(id, v)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
