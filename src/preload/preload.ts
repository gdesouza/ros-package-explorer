import { contextBridge, ipcRenderer } from 'electron';
import type { ExplorerApi, ScanEvent } from '../shared/types';

const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`explorer:${name}`, ...args);

const api: ExplorerApi = {
  openWorkspace: (path) => call('openWorkspace', path),
  refresh: () => call('refresh'),
  cancelScan: () => call('cancelScan'),
  onScanEvent(cb) {
    const listener = (_e: Electron.IpcRendererEvent, event: ScanEvent) => cb(event);
    ipcRenderer.on('scan:event', listener);
    return () => ipcRenderer.removeListener('scan:event', listener);
  },
  readManifest: (s, p) => call('readManifest', s, p),
  listDirectory: (s, p, r) => call('listDirectory', s, p, r),
  previewFile: (s, p, r, e) => call('previewFile', s, p, r, e),
  copyPath: (s, p, r) => call('copyPath', s, p, r),
  showInFolder: (s, p, r) => call('showInFolder', s, p, r),
  openExternal: (u) => call('openExternal', u),
  getPreferences: () => call('getPreferences'),
  setPreferences: (patch) => call('setPreferences', patch),
  removeRecent: (p) => call('removeRecent', p),
};

contextBridge.exposeInMainWorld('explorer', api);
