import { useEffect } from 'react';
import { useAuthStore, useChatStore, useThemeStore } from './store';
import Auth from './pages/Auth';
import Messenger from './pages/Messenger';
import { registerPushIfEnabled, requestNotificationPermissionForPWA } from './push';

export default function App() {
  const { isAuthenticated, init } = useAuthStore();
  const themeInit = useThemeStore((s) => s.init);

  useEffect(() => {
    themeInit();
  }, [themeInit]);
  useEffect(() => {
    init();
  }, [init]);
  useEffect(() => {
    const t = setTimeout(() => {
      useChatStore.getState().loadCacheConfig().catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => {
      requestNotificationPermissionForPWA().catch(() => {});
      registerPushIfEnabled().catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Auth />;
  return <Messenger />;
}
