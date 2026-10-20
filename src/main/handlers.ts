import type {
  ActionResult,
  DirListing,
  ExpectedStat,
  ExplorerApi,
  PreviewResult,
  WorkspaceInfo,
} from '../shared/types';
import { listDirectory, readPreview } from '../core/files';
import { PathDenied, resolveWithin } from '../core/pathGuard';
import { StaleScanError, type ScanManager } from './scanManager';
import type { PreferenceStore } from './preferences';

export interface Platform {
  chooseDirectory(): Promise<string | null>;
  writeClipboard(text: string): void;
  showItemInFolder(path: string): void;
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
}

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isStr = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;

function validExpected(v: unknown): ExpectedStat | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { size, mtimeMs } = v as ExpectedStat;
  return typeof size === 'number' && typeof mtimeMs === 'number' ? { size, mtimeMs } : undefined;
}

type FileHandlers = Pick<
  ExplorerApi,
  | 'openWorkspace'
  | 'refresh'
  | 'cancelScan'
  | 'readManifest'
  | 'listDirectory'
  | 'previewFile'
  | 'copyPath'
  | 'showInFolder'
  | 'openExternal'
  | 'getPreferences'
  | 'setPreferences'
  | 'removeRecent'
>;

/** Validated implementation of every IPC call; the renderer is untrusted. */
export function createHandlers(scans: ScanManager, prefs: PreferenceStore, platform: Platform): FileHandlers {
  const failure = (e: unknown): { state: 'stale' | 'denied' | 'unreadable'; message: string } => {
    if (e instanceof StaleScanError) return { state: 'stale', message: e.message };
    if (e instanceof PathDenied) return { state: 'denied', message: e.message };
    return { state: 'unreadable', message: e instanceof Error ? e.message : String(e) };
  };

  const open = async (root: string): Promise<WorkspaceInfo> => {
    const info = await scans.start(root);
    await prefs.addRecent(info.root);
    return info;
  };

  const resolveTarget = async (scanId: unknown, packageId: unknown, relPath: unknown) => {
    if (!isId(scanId) || !isStr(packageId) || !isStr(relPath)) throw new PathDenied('Invalid request.');
    const pkg = scans.lookup(scanId, packageId);
    const abs = await resolveWithin(pkg.packageDir, relPath);
    return { pkg, abs, isRoot: abs === pkg.packageDir };
  };

  const action = async (fn: () => Promise<void> | void): Promise<ActionResult> => {
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: failure(e).message };
    }
  };

  return {
    async openWorkspace(path) {
      if (path !== undefined) {
        // Only explicit reopen of a remembered workspace may bypass the picker.
        const recent = (await prefs.get()).recentWorkspaces;
        if (!isStr(path) || !recent.includes(path)) throw new Error('Workspace path is not authorized.');
        return open(path);
      }
      const chosen = await platform.chooseDirectory();
      return chosen ? open(chosen) : null;
    },
    async refresh() {
      return scans.root ? scans.refresh() : null;
    },
    async cancelScan() {
      scans.cancel();
    },
    async readManifest(scanId, packageId): Promise<PreviewResult> {
      try {
        if (!isId(scanId) || !isStr(packageId)) throw new PathDenied('Invalid request.');
        return await readPreview(scans.lookup(scanId, packageId).packageDir, 'package.xml');
      } catch (e) {
        return failure(e);
      }
    },
    async listDirectory(scanId, packageId, relPath): Promise<DirListing> {
      try {
        if (!isId(scanId) || !isStr(packageId) || !isStr(relPath)) throw new PathDenied('Invalid request.');
        return await listDirectory(scans.lookup(scanId, packageId).packageDir, relPath);
      } catch (e) {
        return failure(e);
      }
    },
    async previewFile(scanId, packageId, relPath, expected): Promise<PreviewResult> {
      try {
        if (!isId(scanId) || !isStr(packageId) || !isStr(relPath)) throw new PathDenied('Invalid request.');
        return await readPreview(scans.lookup(scanId, packageId).packageDir, relPath, validExpected(expected));
      } catch (e) {
        return failure(e);
      }
    },
    copyPath: (scanId, packageId, relPath) =>
      action(async () => platform.writeClipboard((await resolveTarget(scanId, packageId, relPath)).abs)),
    showInFolder: (scanId, packageId, relPath) =>
      action(async () => {
        const { abs, isRoot } = await resolveTarget(scanId, packageId, relPath);
        if (isRoot) {
          const err = await platform.openPath(abs);
          if (err) throw new Error(err);
        } else platform.showItemInFolder(abs);
      }),
    openExternal: (url) =>
      action(async () => {
        let parsed: URL;
        try {
          parsed = new URL(String(url));
        } catch {
          throw new Error('Invalid URL.');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http and https links can be opened.');
        await platform.openExternal(parsed.toString());
      }),
    getPreferences: () => prefs.get(),
    async setPreferences(patch) {
      const p = (patch ?? {}) as Record<string, unknown>;
      return prefs.update({
        ...(p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? { theme: p.theme } : {}),
        ...(typeof p.sidebarWidth === 'number' ? { sidebarWidth: p.sidebarWidth } : {}),
      });
    },
    removeRecent: (p) => (isStr(p) ? prefs.removeRecent(p) : prefs.get()),
  };
}
