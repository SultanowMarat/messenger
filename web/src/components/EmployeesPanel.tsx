import { useState, useEffect, useCallback, useRef } from 'react';
import { Avatar, IconX, IconPhone, IconUser, IconSearch } from './ui';
import type { UserPublic } from '../types';
import * as api from '../api';
import { useChatStore } from '../store';

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

/** Нормализация для поиска: кириллица → латиница, чтобы "Map" находил "Марат". */
function normalizeForSearch(s: string): string {
  const cyrToLat: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return s
    .toLowerCase()
    .split('')
    .map((c) => cyrToLat[c] ?? c)
    .join('');
}

interface EmployeesPanelProps {
  onSelectUser: (userId: string) => void;
  onAdd: () => void;
  /** Увеличить после добавления сотрудника, чтобы обновить список */
  refreshTrigger?: number;
}

export default function EmployeesPanel({ onSelectUser, onAdd, refreshTrigger }: EmployeesPanelProps) {
  const [employees, setEmployees] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const searchNorm = search.trim().toLowerCase();
  const searchNormLat = normalizeForSearch(search.trim());
  const filteredEmployees = searchNorm
    ? employees.filter(
        (u) =>
          u.username.toLowerCase().includes(searchNorm) ||
          normalizeForSearch(u.username).includes(searchNormLat) ||
          (u.email && (u.email.toLowerCase().includes(searchNorm) || normalizeForSearch(u.email).includes(searchNormLat))) ||
          (u.phone && u.phone.includes(searchNorm))
      )
    : employees;

  const fetchList = useCallback(() => {
    setLoading(true);
    api.listEmployees()
      .then(setEmployees)
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList, refreshTrigger]);

  return (
    <div className="h-full flex flex-col bg-sidebar min-w-0 overflow-x-hidden safe-bottom">
      <div className="px-4 pb-2 shrink-0" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sidebar-title font-semibold text-white">Сотрудники</h2>
          <button
            type="button"
            onClick={onAdd}
            className="min-h-[44px] px-3 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            Добавить
          </button>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-text pointer-events-none">
            <IconSearch size={18} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти сотрудников"
            className="w-full pl-10 pr-3 py-2.5 bg-sidebar-hover rounded-compass text-[14px] text-white placeholder:text-sidebar-text border border-transparent focus:border-primary/50 focus:ring-2 focus:ring-primary/20 outline-none transition-colors"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll">
        {loading && (
          <p className="text-center text-sidebar-text text-[13px] py-8">Загрузка...</p>
        )}
        {!loading && employees.length === 0 && (
          <p className="text-center text-sidebar-text text-[13px] py-8">Нет сотрудников</p>
        )}
        {!loading && employees.length > 0 && filteredEmployees.length === 0 && (
          <p className="text-center text-sidebar-text text-[13px] py-8">Ничего не найдено</p>
        )}
        {!loading && employees.length > 0 && filteredEmployees.length > 0 && (
          <div className="pb-4">
            {filteredEmployees.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => onSelectUser(u.id)}
                className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 hover:bg-sidebar-hover transition-colors text-left border-b border-sidebar-border/30"
              >
                <Avatar name={u.username} url={u.avatar_url || undefined} size={44} />
                <div className="min-w-0 flex-1">
                  <span className="text-sidebar-name font-medium text-white/90 truncate block">{u.username}</span>
                  {u.email && (
                    <span className="text-[12px] text-sidebar-text truncate block">{u.email}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── New Employee Card (пустая карточка: ввод данных, роли, сохранить) ─── */
interface NewEmployeeCardProps {
  onClose: () => void;
  onCreated: () => void;
}

export function NewEmployeeCard({ onClose, onCreated }: NewEmployeeCardProps) {
  const { uploadFile } = useChatStore();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<PermissionId, boolean>>({ ...DEFAULT_PERMISSIONS });
  const [emailErr, setEmailErr] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setOnePermission = useCallback((id: PermissionId, value: boolean) => {
    setPermissions((p) => ({ ...p, [id]: value }));
  }, []);

  const handleAvatar = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadFile(file);
      setAvatarUrl(res.url);
    } catch { /* */ }
  }, [uploadFile]);

  const handleSave = useCallback(async () => {
    const eErr = validateEmail(email);
    const pErr = validatePhone(phone);
    setEmailErr(eErr);
    setPhoneErr(pErr);
    if (!username.trim() || !email.trim() || eErr || pErr) return;
    setSaving(true);
    try {
      await api.createUser({
        email: email.trim().toLowerCase(),
        username: username.trim(),
        phone: phone.trim() || undefined,
        avatar_url: avatarUrl ?? undefined,
        permissions,
      });
      onCreated();
      onClose();
    } catch { /* */ }
    setSaving(false);
  }, [username, email, phone, avatarUrl, permissions, onCreated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 safe-area-padding">
      <div className="absolute inset-0 bg-[rgba(4,4,10,0.55)] dark:bg-black/60" onClick={onClose} />
      <div className="relative bg-white dark:bg-dark-elevated rounded-[16px] shadow-compass-dialog w-full max-w-[400px] max-h-[90vh] flex flex-col overflow-hidden border border-transparent dark:border-dark-border animate-dialog">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 text-txt dark:text-white transition-colors"
          aria-label="Закрыть"
        >
          <IconX size={14} />
        </button>

        <div className="flex-shrink-0 px-5 pt-6 pb-2">
          <h3 className="text-[16px] font-bold text-txt dark:text-[#e7e9ea]">Новый сотрудник</h3>
          <p className="text-[12px] text-txt-placeholder dark:text-[#8b98a5] mt-1">При входе по этой почте откроется этот профиль</p>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 space-y-4">
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative cursor-pointer group"
            >
              <Avatar name={username || '?'} url={avatarUrl ?? undefined} size={80} />
              <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 dark:group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <span className="text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">Фото</span>
              </div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          </div>

          <div className="flex items-start gap-3 px-4 py-3 rounded-[12px] bg-[#f0f0f0] dark:bg-[#2f3336] border border-transparent dark:border-white/10">
            <span className="text-txt-secondary dark:text-[#8b98a5] flex-shrink-0 mt-0.5"><IconUser size={20} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-txt-placeholder dark:text-[#8b98a5] mb-1">Имя</p>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-transparent text-[14px] font-medium text-txt dark:text-[#e7e9ea] focus:outline-none" placeholder="Имя" />
            </div>
          </div>
          <div className={`flex items-start gap-3 px-4 py-3 rounded-[12px] bg-[#f0f0f0] dark:bg-[#2f3336] border dark:border-white/10 ${emailErr ? 'ring-2 ring-danger/40' : 'border-transparent'}`}>
            <span className="text-txt-secondary dark:text-[#8b98a5] flex-shrink-0 mt-0.5">@</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-txt-placeholder dark:text-[#8b98a5] mb-1">Почта</p>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailErr(validateEmail(e.target.value)); }} className="w-full bg-transparent text-[14px] font-medium text-txt dark:text-[#e7e9ea] focus:outline-none" placeholder="email@example.com" />
              {emailErr && <p className="text-[12px] text-danger mt-1">{emailErr}</p>}
            </div>
          </div>
          <div className={`flex items-start gap-3 px-4 py-3 rounded-[12px] bg-[#f0f0f0] dark:bg-[#2f3336] border dark:border-white/10 ${phoneErr ? 'ring-2 ring-danger/40' : 'border-transparent'}`}>
            <span className="text-txt-secondary dark:text-[#8b98a5] flex-shrink-0 mt-0.5"><IconPhone size={20} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-txt-placeholder dark:text-[#8b98a5] mb-1">Телефон</p>
              <input type="tel" value={phone} onChange={(e) => { let v = e.target.value.replace(/[^\d+]/g, ''); if (v && !v.startsWith('+')) v = '+' + v; if (v.length > 16) v = v.slice(0, 16); setPhone(v); setPhoneErr(validatePhone(v)); }} className="w-full bg-transparent text-[14px] font-medium text-txt dark:text-[#e7e9ea] focus:outline-none" placeholder="+7 999 123-45-67" />
              {phoneErr && <p className="text-[12px] text-danger mt-1">{phoneErr}</p>}
            </div>
          </div>

          <section>
            <h4 className="text-[13px] font-bold text-txt dark:text-[#e7e9ea] mb-2">Чаты</h4>
            <div className="space-y-0 divide-y divide-surface-border dark:divide-white/10">
              {CHAT_PERMISSIONS.map(({ id, label }) => (
                <label key={id} className="flex items-center justify-between gap-3 min-h-[44px] py-2 cursor-pointer select-none">
                  <span className="text-[14px] text-txt dark:text-[#e7e9ea] flex-1 min-w-0 break-words">{label}</span>
                  <input type="checkbox" checked={permissions[id]} onChange={(e) => setOnePermission(id, e.target.checked)} className="rounded border-gray-300" />
                </label>
              ))}
            </div>
          </section>
          <section>
            <h4 className="text-[13px] font-bold text-txt dark:text-[#e7e9ea] mb-2">Участники</h4>
            <div className="space-y-0 divide-y divide-surface-border dark:divide-white/10">
              {PARTICIPANT_PERMISSIONS.map(({ id, label }) => (
                <label key={id} className="flex items-center justify-between gap-3 min-h-[44px] py-2 cursor-pointer select-none">
                  <span className="text-[14px] text-txt dark:text-[#e7e9ea] flex-1 min-w-0 break-words">{label}</span>
                  <input type="checkbox" checked={permissions[id]} onChange={(e) => setOnePermission(id, e.target.checked)} className="rounded border-gray-300" />
                </label>
              ))}
            </div>
          </section>

          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={saving || !username.trim() || !email.trim()} className="flex-1 py-2.5 rounded-[12px] font-semibold text-[14px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition-colors">Сохранить</button>
            <button onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-[12px] font-semibold text-[14px] bg-[#f0f0f0] dark:bg-[#2f3336] text-txt dark:text-[#e7e9ea] hover:opacity-90 disabled:opacity-50 transition-colors">Отмена</button>
          </div>
        </div>
      </div>
    </div>
  );
}
