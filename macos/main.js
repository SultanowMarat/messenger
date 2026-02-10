const { app, BrowserWindow, ipcMain, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'server-url.json');

let isQuitting = false;

function getStoredUrl() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    const j = JSON.parse(data);
    return typeof j.url === 'string' ? j.url.trim() : '';
  } catch {
    return '';
  }
}

function setStoredUrl(url) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ url: url || '' }), 'utf8');
  } catch (e) {
    console.error('setStoredUrl:', e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 400,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Мессенджер',
  });

  const gatePath = path.join(__dirname, 'gate', 'index.html');
  const stored = getStoredUrl();
  if (stored) {
    win.loadURL(stored).catch(() => win.loadFile(gatePath));
    const onFail = () => {
      win.webContents.removeListener('did-fail-load', onFail);
      win.loadFile(gatePath);
    };
    win.webContents.on('did-fail-load', (event, code) => {
      if (code !== -3) onFail();
    });
  } else {
    win.loadFile(gatePath);
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Красная кнопка (крестик) — скрыть окно; Cmd+Q или «Завершить» — полный выход.
  if (process.platform === 'darwin') {
    win.on('close', (e) => {
      if (isQuitting || win.isFullScreen()) return;
      e.preventDefault();
      win.hide();
    });
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [{ role: 'about' }],
      },
    ]));
  }
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isQuitting) app.quit();
});

app.on('activate', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) createWindow();
  else wins[0].show();
});

ipcMain.handle('get-server-url', () => getStoredUrl());
ipcMain.handle('set-server-url', (_, url) => {
  const u = typeof url === 'string' ? url.trim() : '';
  setStoredUrl(u);
  return u;
});
ipcMain.handle('open-app-url', (_, url) => {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return;
  setStoredUrl(u);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.loadURL(u);
});

ipcMain.handle('set-badge-count', (_, count) => {
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  app.setBadgeCount(n);
});

ipcMain.handle('show-notification', (_, opts) => {
  if (!Notification.isSupported()) return;
  const title = (opts && typeof opts.title === 'string') ? opts.title : 'Мессенджер';
  const body = (opts && typeof opts.body === 'string') ? opts.body : '';
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.show();
      win.focus();
    }
  });
  n.show();
});
