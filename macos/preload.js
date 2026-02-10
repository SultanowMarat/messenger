const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),
  openAppUrl: (url) => ipcRenderer.invoke('open-app-url', url),
  setBadgeCount: (count) => ipcRenderer.invoke('set-badge-count', count),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
});
