import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../store';
import { IconCompass } from '../components/ui';
import { getStoredServerUrl, setServerUrl, checkServerReachable } from '../serverUrl';

type Step = 'email' | 'code';

export default function Auth() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverUrlError, setServerUrlError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { requestCode, verifyCode } = useAuthStore();

  useEffect(() => {
    setServerUrlInput(getStoredServerUrl() || window.location.origin);
  }, []);

  const handleRequestCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setServerUrlError('');
    const url = serverUrlInput.trim() || window.location.origin;
    setServerUrl(url);
    setLoading(true);
    try {
      const ok = await checkServerReachable(url);
      if (!ok) {
        setServerUrlError('Адрес недоступен');
        setLoading(false);
        return;
      }
      await requestCode(email);
      setStep('code');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  }, [email, serverUrlInput, requestCode]);

  const handleVerifyCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyCode(email, code);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Неверный или истёкший код');
    } finally {
      setLoading(false);
    }
  }, [email, code, verifyCode]);

  return (
    <div className="min-h-screen min-h-[100dvh] min-w-0 max-w-[100vw] flex items-center justify-center bg-surface dark:bg-dark-bg p-4 safe-area-padding overflow-x-hidden">
      <div className="w-full max-w-[380px] min-w-0">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-[18px] mb-4">
            <IconCompass size={32} />
          </div>
          <h1 className="text-[24px] font-bold text-txt dark:text-[#e7e9ea] tracking-[-0.3px]">Мессенджер</h1>
          <p className="text-txt-secondary dark:text-[#8b98a5] text-[14px] mt-1">Корпоративный мессенджер</p>
        </div>

        <div className="bg-white dark:bg-dark-elevated rounded-compass shadow-compass-dialog overflow-hidden border border-transparent dark:border-dark-border">
          <div className="p-5 space-y-4">
            {error && (
              <div className="bg-danger/8 text-danger text-[13px] rounded-compass px-3.5 py-2.5 font-medium">{error}</div>
            )}

            {step === 'email' ? (
              <form onSubmit={handleRequestCode} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-txt-secondary dark:text-[#8b98a5] mb-1.5">Адрес сервера</label>
                  <input
                    type="url"
                    value={serverUrlInput}
                    onChange={(e) => { setServerUrlInput(e.target.value); setServerUrlError(''); }}
                    className="compass-input"
                    placeholder="https://example.com"
                    autoComplete="url"
                  />
                  {serverUrlError && (
                    <p className="mt-1.5 text-[13px] font-medium text-danger">{serverUrlError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-txt-secondary dark:text-[#8b98a5] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="compass-input"
                    placeholder="name@company.com"
                    autoComplete="email"
                    required
                  />
                </div>
                <button type="submit" disabled={loading} className="compass-btn-primary w-full py-3 mt-1">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Отправка...
                    </span>
                  ) : (
                    'Получить код'
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <p className="text-[13px] text-txt-secondary dark:text-[#8b98a5]">
                  Код отправлен на <strong className="text-txt dark:text-[#e7e9ea]">{email}</strong>
                </p>
                <div>
                  <label className="block text-[13px] font-medium text-txt-secondary dark:text-[#8b98a5] mb-1.5">Код из письма</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="compass-input text-center tracking-[0.3em] font-mono text-lg"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>
                <button type="submit" disabled={loading || code.length < 4} className="compass-btn-primary w-full py-3 mt-1">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Вход...
                    </span>
                  ) : (
                    'Войти'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('email'); setCode(''); setError(''); }}
                  className="w-full text-[13px] text-primary hover:underline"
                >
                  Указать другой email
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
