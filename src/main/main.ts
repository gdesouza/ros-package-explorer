import { BrowserWindow, app, clipboard, dialog, ipcMain, nativeTheme, session, shell, type IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import type { ScanEvent } from '../shared/types';
import { createHandlers } from './handlers';
import { PreferenceStore } from './preferences';
import { ScanManager } from './scanManager';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

const appOrigin = () => (MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin : 'file://');

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return e.sender === mainWindow?.webContents && url.startsWith(appOrigin());
}

function createWindow(prefsTheme: 'system' | 'light' | 'dark', width: number) {
  const win = new BrowserWindow({
    width: Math.max(1100, width + 760),
    height: 760,
    minWidth: 820,
    minHeight: 520,
    title: 'ROS Package Explorer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  nativeTheme.themeSource = prefsTheme;
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  return win;
}

function setup() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const prefs = new PreferenceStore(path.join(app.getPath('userData'), 'preferences.json'));
  const scans = new ScanManager(path.join(__dirname, 'scanWorker.js'), (event: ScanEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan:event', event);
  });
  const handlers = createHandlers(scans, prefs, {
    async chooseDirectory() {
      const opts = { title: 'Open workspace folder', properties: ['openDirectory' as const] };
      const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    writeClipboard: (t) => clipboard.writeText(t),
    showItemInFolder: (p) => shell.showItemInFolder(p),
    openPath: (p) => shell.openPath(p),
    openExternal: (u) => shell.openExternal(u),
  });

  const channel = <K extends keyof typeof handlers>(name: K) => {
    ipcMain.handle(`explorer:${name}`, (e, ...args) => {
      if (!trusted(e)) throw new Error('Untrusted sender.');
      return (handlers[name] as (...a: unknown[]) => unknown)(...args);
    });
  };
  (Object.keys(handlers) as (keyof typeof handlers)[]).filter((k) => k !== 'setPreferences').forEach(channel);

  ipcMain.handle('explorer:setPreferences', async (e, patch) => {
    if (!trusted(e)) throw new Error('Untrusted sender.');
    const result = await handlers.setPreferences(patch);
    nativeTheme.themeSource = result.theme;
    return result;
  });

  app.on('before-quit', () => scans.dispose());
  return prefs;
}

app.whenReady().then(async () => {
  const prefs = setup();
  const p = await prefs.get();
  mainWindow = createWindow(p.theme, p.sidebarWidth);
  mainWindow.on('closed', () => (mainWindow = null));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(p.theme, p.sidebarWidth);
      mainWindow.on('closed', () => (mainWindow = null));
    }
  });
});

app.on('window-all-closed', () => app.quit());
