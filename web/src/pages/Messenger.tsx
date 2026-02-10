import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuthStore, useChatStore, useThemeStore, type ThemePreference } from '../store';
import Sidebar from '../components/Sidebar';
import Chat from '../components/Chat';
import ChatInfo from '../components/ChatInfo';
import CallUI from '../components/CallUI';
import UserCard from '../components/UserCard';
import EmployeesPanel, { NewEmployeeCard } from '../components/EmployeesPanel';
import { Avatar, Modal, IconChat, IconSearch, IconMessageCircle, IconX, IconLogout, IconMail, IconPhone, IconUser, IconUsers } from '../components/ui';
import type { Message } from '../types';
import * as api from '../api';

export default function Messenger() {
  const { user, logout, updateProfile, loadUser } = useAuthStore();
  const { activeChatId, chats, connectWS, disconnectWS, fetchChats, fetchFavorites, hydrateFavoritesFromStorage, searchMessages, setActiveChat, createPersonalChat, notification, setNotification } = useChatStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification, setNotification]);
  const [showInfo, setShowInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchChatId, setSearchChatId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [navTab, setNavTab] = useState<'chats' | 'search' | 'employees'>('chats');
  const [myAdministrator, setMyAdministrator] = useState(false);
  const [employeeCardUserId, setEmployeeCardUserId] = useState<string | null>(null);
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [employeesRefresh, setEmployeesRefresh] = useState(0);

  useEffect(() => {
    if (user === null) loadUser();
  }, [user, loadUser]);

  useEffect(() => {
    const meId = user?.id;
    if (!meId) return;
    let cancelled = false;
    api.getUserPermissions(meId)
      .then((res) => { if (!cancelled) setMyAdministrator(res.administrator); })
      .catch(() => { if (!cancelled) setMyAdministrator(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    connectWS();
    if (!user?.id) return () => disconnectWS();
    hydrateFavoritesFromStorage();
    fetchChats().then(() => fetchFavorites());
    useChatStore.getState().connectCallWS();
    return () => disconnectWS();
  }, [user?.id, hydrateFavoritesFromStorage, fetchChats, fetchFavorites, connectWS, disconnectWS]);

  const activeChat = useMemo(() => chats.find((c) => c.chat.id === activeChatId), [chats, activeChatId]);

  const handleChatSelect = useCallback(() => {
    setSidebarOpen(false);
    setShowInfo(false);
  }, []);

  if (user === null) {
    return (
      <div className="h-full flex items-center justify-center bg-surface dark:bg-dark-bg">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-txt-secondary dark:text-[#8b98a5] text-[14px]">Загрузка профиля...</p>
          <button type="button" onClick={() => loadUser()} className="mt-2 text-[13px] text-primary hover:underline">
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[100dvh] w-full max-w-[100vw] flex flex-col md:flex-row bg-surface dark:bg-dark-bg safe-top safe-x safe-bottom overflow-x-hidden">
      {/* ── Toast: добавление/исключение участника ── */}
      {notification && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[100] px-4 py-3 bg-txt text-white text-[13px] font-medium rounded-compass shadow-compass-dialog animate-fade max-w-[90vw]"
          style={{ top: 'max(1rem, env(safe-area-inset-top))' }}>
          {notification}
        </div>
      )}

      <CallUI />

      {/* ── Nav Rail (PWA: safe areas) ── */}
      <nav className="hidden md:flex flex-col items-center w-[60px] min-w-[60px] bg-nav shrink-0 py-3 gap-0.5 safe-left" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <button title="Профиль" onClick={() => setShowProfile(true)}
          className="w-10 h-10 flex items-center justify-center rounded-[10px] transition-all duration-200 ease-out text-sidebar-text hover:text-white hover:bg-nav-hover overflow-hidden shrink-0 mb-5">
          <Avatar name={user?.username || ''} url={user?.avatar_url} size={28} />
        </button>
        <NavBtn icon={<IconChat />} active={navTab === 'chats'} tip="Чаты"
          onClick={() => { setNavTab('chats'); setShowSearch(false); }} />
        <NavBtn icon={<IconSearch size={22} />} active={navTab === 'search'} tip="Поиск"
          onClick={() => { setSearchChatId(null); setNavTab('search'); setShowSearch(true); }} />
        {myAdministrator && (
          <NavBtn icon={<IconUsers size={22} />} active={navTab === 'employees'} tip="Сотрудники"
            onClick={() => { setNavTab('employees'); setShowSearch(false); }} />
        )}

        <div className="flex-1" />
      </nav>

      {/* ── Sidebar / Search / Employees ── */}
      <div className={`${activeChatId && !sidebarOpen ? 'hidden md:flex' : 'flex'} flex-col w-full max-w-full md:w-[300px] lg:w-[320px] shrink-0 min-w-0 border-r border-surface-border dark:border-dark-border overflow-x-hidden`}>
        {navTab === 'employees' ? (
          <EmployeesPanel refreshTrigger={employeesRefresh} onSelectUser={(id) => setEmployeeCardUserId(id)} onAdd={() => setShowNewEmployee(true)} />
        ) : showSearch ? (
          <SearchPanel
            chatId={searchChatId}
            onSelect={(msg) => { setActiveChat(msg.chat_id); setShowSearch(false); setNavTab('chats'); }}
            onClose={() => { setShowSearch(false); setNavTab('chats'); }} />
        ) : (
          <Sidebar onChatSelect={handleChatSelect} onOpenProfile={() => setShowProfile(true)} />
        )}
      </div>

      {/* ── Chat Area ── */}
      <div className={`${!activeChatId || sidebarOpen ? 'hidden md:flex' : 'flex'} flex-1 min-w-0 min-h-0 overflow-hidden overflow-x-hidden transition-[opacity] duration-200 ease-out`}>
        {activeChatId ? (
          <div className="flex flex-1 h-full min-w-0 overflow-hidden">
            <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${showInfo ? 'hidden lg:flex' : 'flex'} transition-[opacity] duration-150 ease-out`}>
              <Chat onBack={() => setSidebarOpen(true)} onOpenInfo={() => setShowInfo(true)} onOpenSearch={() => { setSearchChatId(activeChatId); setShowSearch(true); setNavTab('search'); }} onOpenProfile={() => setShowProfile(true)} />
            </div>
            {showInfo && activeChat && (
              <div className="w-full lg:w-[320px] shrink-0 border-l border-surface-border dark:border-dark-border">
                <ChatInfo chat={activeChat} onClose={() => setShowInfo(false)} />
              </div>
            )}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {employeeCardUserId && (
        <UserCard
          userId={employeeCardUserId}
          onClose={() => setEmployeeCardUserId(null)}
          onOpenChat={(uid) => {
            createPersonalChat(uid).then((c) => setActiveChat(c.chat.id)).catch(() => {});
            setEmployeeCardUserId(null);
          }}
        />
      )}
      {showNewEmployee && (
        <NewEmployeeCard
          onClose={() => setShowNewEmployee(false)}
          onCreated={() => setEmployeesRefresh((r) => r + 1)}
        />
      )}
    </div>
  );
}

/* ── Nav Button ── */
function NavBtn({ icon, active, tip, onClick }: { icon: React.ReactNode; active?: boolean; tip?: string; onClick?: () => void }) {
  return (
    <button title={tip} onClick={onClick}
      className={`min-w-[44px] min-h-[44px] w-10 h-10 flex items-center justify-center rounded-[10px] transition-all duration-200 ease-out ${
        active ? 'bg-nav-active text-white' : 'text-sidebar-text hover:text-white hover:bg-nav-hover'
      }`}>
      {icon}
    </button>
  );
}

/* ── Empty State ── */
function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-dark-bg">
      <div className="w-20 h-20 rounded-full bg-surface dark:bg-dark-elevated flex items-center justify-center mb-4">
        <IconMessageCircle />
      </div>
      <p className="text-txt-secondary dark:text-[#8b98a5] text-[14px]">Выберите чат для начала общения</p>
    </div>
  );
}

/* ── Search Panel ── */
function SearchPanel({ chatId, onSelect, onClose }: { chatId: string | null; onSelect: (msg: Message) => void; onClose: () => void }) {
  const { searchMessages } = useChatStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try { setResults(await searchMessages(q, chatId ?? undefined)); } catch { /* */ }
      setLoading(false);
    }, 400);
  }, [searchMessages, chatId]);

  useEffect(() => {
    setResults([]);
  }, [chatId]);

  return (
    <div className="h-full flex flex-col bg-sidebar safe-bottom">
      <div className="px-4 pt-4 pb-2 shrink-0" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-bold text-white">Поиск</h2>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-sidebar-hover text-sidebar-text hover:text-white transition-colors -mr-2">
            <IconX size={12} />
          </button>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-text"><IconSearch size={16} /></span>
          <input type="text" value={query} onChange={(e) => handleSearch(e.target.value)} autoFocus
            placeholder={chatId ? 'Поиск в текущем чате...' : 'Поиск по сообщениям...'}
            className="w-full pl-9 pr-3 py-2 bg-sidebar-hover rounded-compass text-[13px] text-white placeholder:text-sidebar-text border border-transparent focus:border-primary/40 outline-none transition-colors" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll">
        {loading && <p className="text-center text-sidebar-text text-[13px] py-8">Поиск...</p>}
        {!loading && query && results.length === 0 && <p className="text-center text-sidebar-text text-[13px] py-8">Ничего не найдено</p>}
        {results.map((msg) => (
          <button key={msg.id} onClick={() => onSelect(msg)}
            className="w-full min-h-[48px] flex items-start gap-3 px-4 py-3 hover:bg-sidebar-hover transition-colors text-left border-b border-sidebar-border/30">
            <Avatar name={msg.sender?.username || ''} url={msg.sender?.avatar_url || undefined} size={36} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white truncate">{msg.sender?.username}</span>
                <span className="text-[11px] text-sidebar-text shrink-0 ml-2">{new Date(msg.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
              </div>
              <p className="text-[12px] text-sidebar-text mt-0.5 line-clamp-2">{msg.content}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Validation helpers ── */
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

/* Поле редактирования в стиле первого слайда: иконка слева, подпись сверху, инпут снизу */
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

/* ── Profile Modal (стиль первого слайда, с учётом выбранной темы) ── */
function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateProfile, logout } = useAuthStore();
  const { preference: themePreference, setTheme } = useThemeStore();
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [emailErr, setEmailErr] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [saving, setSaving] = useState(false);
  const { uploadFile } = useChatStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setEmail(v);
    setEmailErr(validateEmail(v));
  }, []);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    v = v.replace(/[^\d+]/g, '');
    if (v.length > 0 && !v.startsWith('+')) v = '+' + v;
    if (v.length > 16) v = v.slice(0, 16);
    setPhone(v);
    setPhoneErr(validatePhone(v));
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
    try {
      await updateProfile({ username, email, phone });
    } catch { /* */ }
    setSaving(false);
    onClose();
  }, [username, email, phone, updateProfile, onClose]);

  const handleAvatar = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const res = await uploadFile(file);
      await updateProfile({ avatar_url: res.url });
    } catch { /* */ }
    setSaving(false);
  }, [uploadFile, updateProfile]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 safe-area-padding">
      <div className="absolute inset-0 bg-[rgba(4,4,10,0.55)] dark:bg-black/60" onClick={onClose} />
      <div className="relative bg-white dark:bg-dark-elevated rounded-[16px] shadow-compass-dialog w-full max-w-[400px] animate-dialog overflow-visible border border-transparent dark:border-dark-border">
        {/* Кнопка закрытия — как на первом слайде, с учётом темы */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 text-txt dark:text-white transition-colors"
          aria-label="Закрыть"
        >
          <IconX size={14} />
        </button>

        {/* Шапка: аватар и имя — как первый слайд, градиент в светлой теме */}
        <div className="flex flex-col items-center pt-8 pb-5 bg-gradient-to-b from-primary/5 to-transparent dark:from-transparent dark:to-transparent">
          <div className="relative cursor-pointer group" onClick={() => fileRef.current?.click()}>
            <Avatar name={user?.username || ''} url={user?.avatar_url} size={96} online />
            <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 dark:group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <span className="text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">Изменить</span>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          <h2 className="mt-3 text-[20px] font-bold text-txt dark:text-[#e7e9ea]">{username || user?.username || 'Профиль'}</h2>
          <p className="text-[12px] text-txt-placeholder dark:text-[#8b98a5] mt-1">Нажмите для смены аватара</p>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Тема — кнопки в стиле первого слайда (скруглённые блоки), выбранная = primary */}
          <div>
            <label className="block text-[13px] font-medium text-txt-secondary dark:text-[#8b98a5] mb-2">Тема</label>
            <div className="flex gap-2 flex-wrap">
              {(['light', 'dark', 'system'] as ThemePreference[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`flex-1 min-w-0 px-3 py-2.5 rounded-[12px] text-[13px] font-medium transition-colors ${
                    themePreference === t
                      ? 'bg-primary text-white'
                      : 'bg-[#f0f0f0] dark:bg-[#2f3336] text-txt dark:text-[#e7e9ea] hover:bg-[#e8e8e8] dark:hover:bg-white/10 border border-transparent dark:border-white/10'
                  }`}
                >
                  {t === 'light' ? 'Светлая' : t === 'dark' ? 'Тёмная' : 'Как в системе'}
                </button>
              ))}
            </div>
          </div>

          {/* Поля в стиле первого слайда: иконка слева, подпись сверху, инпут */}
          <ProfileEditField
            icon={<IconUser size={20} />}
            label="Имя пользователя"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Имя"
          />
          <ProfileEditField
            icon={<IconMail size={20} />}
            label="Адрес электронной почты"
            value={email}
            onChange={handleEmailChange}
            placeholder="user@example.com"
            type="email"
            error={emailErr}
          />
          <ProfileEditField
            icon={<IconPhone size={20} />}
            label="Номер телефона"
            value={phone}
            onChange={handlePhoneChange}
            placeholder="+7 999 123-45-67"
            type="tel"
            error={phoneErr}
            hint="Международный формат: + и цифры"
          />

          {/* Футер: Сохранить (primary), Выйти (красный текст, как на втором слайде) */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !username.trim() || hasErrors}
              className="flex-1 py-2.5 rounded-[12px] font-semibold text-[15px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              Сохранить
            </button>
            <button
              onClick={() => { logout(); onClose(); }}
              className="flex items-center gap-1.5 px-4 py-2.5 text-danger hover:bg-danger/5 dark:hover:bg-danger/10 rounded-[12px] transition-colors"
            >
              <IconLogout />
              <span className="text-[14px] font-semibold">Выйти</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
