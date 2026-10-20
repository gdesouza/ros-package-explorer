import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers, type Platform } from '../src/main/handlers';
import { PreferenceStore } from '../src/main/preferences';
import { ScanManager } from '../src/main/scanManager';
import type { ScanEvent } from '../src/shared/types';
import { manifest } from './helpers';

let tmp: string;
let workerPath: string;

const w = (rel: string, content: string) => {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rpe-scan-')));
  const outDir = path.join(tmp, 'worker-out');
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      target: 'node22',
      lib: { entry: path.resolve('src/worker/scanWorker.ts'), formats: ['cjs'], fileName: () => 'scanWorker.js' },
      rollupOptions: { external: [/^node:/, 'fs', 'path', 'worker_threads', 'fs/promises'] },
    },
  });
  workerPath = path.join(outDir, 'scanWorker.js');
  for (const ws of ['wsA', 'wsB']) {
    for (let i = 0; i < 30; i++) w(`${ws}/p${i}/package.xml`, manifest(`${ws}_${i}`));
  }
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const until = (events: ScanEvent[], pred: (e: ScanEvent) => boolean) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    const iv = setInterval(() => {
      if (events.some(pred)) {
        clearTimeout(t);
        clearInterval(iv);
        resolve();
      }
    }, 10);
  });

describe('ScanManager', () => {
  it('completes a scan with batches, index and finish', async () => {
    const events: ScanEvent[] = [];
    const m = new ScanManager(workerPath, (e) => events.push(e));
    const info = await m.start(path.join(tmp, 'wsA'));
    await until(events, (e) => e.type === 'finished');
    const finished = events.find((e) => e.type === 'finished');
    expect(finished).toMatchObject({ state: 'complete', scanId: info.scanId });
    const pkgs = events.flatMap((e) => (e.type === 'batch' ? e.packages : []));
    expect(pkgs).toHaveLength(30);
    expect(events.some((e) => e.type === 'index')).toBe(true);
    m.dispose();
  });

  it('drops every event from a superseded scan when the workspace switches', async () => {
    const events: ScanEvent[] = [];
    const m = new ScanManager(workerPath, (e) => events.push(e));
    const a = await m.start(path.join(tmp, 'wsA'));
    const b = await m.start(path.join(tmp, 'wsB'));
    await until(events, (e) => e.type === 'finished' && e.scanId === b.scanId);
    await new Promise((r) => setTimeout(r, 150));
    const late = events.filter((e) => e.scanId === a.scanId && e.type !== 'started');
    expect(late).toHaveLength(0);
    for (const e of events) {
      if (e.type === 'batch' && e.scanId === b.scanId) expect(e.packages.every((p) => p.packageDir.includes('wsB'))).toBe(true);
    }
    expect(() => m.lookup(a.scanId, 'p0/package.xml')).toThrow(/changed/);
    expect(m.lookup(b.scanId, 'p0/package.xml').packageDir).toContain('wsB');
    m.dispose();
  });

  it('cancels, reports incomplete results, and a refresh completes normally', async () => {
    for (let i = 0; i < 400; i++) w(`wsBig/d${i}/p/package.xml`, manifest(`big_${i}`));
    const events: ScanEvent[] = [];
    const m = new ScanManager(workerPath, (e) => events.push(e));
    await m.start(path.join(tmp, 'wsBig'));
    m.cancel();
    await until(events, (e) => e.type === 'finished');
    expect(events.find((e) => e.type === 'finished')).toMatchObject({ state: 'cancelled' });
    const refreshed = await m.refresh();
    await until(events, (e) => e.type === 'finished' && e.scanId === refreshed.scanId);
    expect(events.find((e) => e.type === 'finished' && e.scanId === refreshed.scanId)).toMatchObject({ state: 'complete' });
    m.dispose();
  });
});

describe('IPC handlers authorization', () => {
  const platform = (calls: string[]): Platform => ({
    chooseDirectory: async () => path.join(tmp, 'wsA'),
    writeClipboard: (t) => calls.push(`clip:${t}`),
    showItemInFolder: (p) => calls.push(`show:${p}`),
    openPath: async (p) => (calls.push(`open:${p}`), ''),
    openExternal: async (u) => void calls.push(`ext:${u}`),
  });

  it('rejects traversal, stale scans, unknown packages and unauthorized workspace paths', async () => {
    const events: ScanEvent[] = [];
    const calls: string[] = [];
    const m = new ScanManager(workerPath, (e) => events.push(e));
    const prefs = new PreferenceStore(path.join(tmp, 'prefs', 'p.json'));
    const h = createHandlers(m, prefs, platform(calls));
    const info = (await h.openWorkspace())!;
    await until(events, (e) => e.type === 'finished');

    expect((await h.previewFile(info.scanId, 'p0/package.xml', 'package.xml')).state).toBe('text');
    expect((await h.previewFile(info.scanId, 'p0/package.xml', '../p1/package.xml')).state).toBe('denied');
    expect((await h.previewFile(info.scanId, 'p0/package.xml', '/etc/passwd')).state).toBe('denied');
    expect((await h.previewFile(info.scanId, '../../etc', 'passwd')).state).toBe('stale');
    expect((await h.previewFile(info.scanId + 1, 'p0/package.xml', 'package.xml')).state).toBe('stale');
    expect((await h.previewFile('1' as unknown as number, 'p0/package.xml', 'package.xml')).state).toBe('denied');
    expect((await h.listDirectory(info.scanId, 'p0/package.xml', '..')).state).toBe('denied');
    expect((await h.readManifest(info.scanId, 'p0/package.xml')).state).toBe('text');
    expect(await h.copyPath(info.scanId, 'p0/package.xml', '../x')).toMatchObject({ ok: false });
    expect(await h.copyPath(info.scanId, 'p0/package.xml', 'package.xml')).toEqual({ ok: true });
    expect(calls).toEqual([`clip:${path.join(tmp, 'wsA/p0/package.xml')}`]);

    await expect(h.openWorkspace('/etc')).rejects.toThrow(/not authorized/);
    expect(await h.openWorkspace(info.root)).toMatchObject({ root: info.root });

    expect(await h.openExternal('file:///etc/passwd')).toMatchObject({ ok: false });
    expect(await h.openExternal('javascript:alert(1)')).toMatchObject({ ok: false });
    expect(await h.openExternal('https://example.org/x')).toEqual({ ok: true });
    m.dispose();
  });

  it('persists recents without scanning, and removes them', async () => {
    const file = path.join(tmp, 'prefs2', 'p.json');
    const p1 = new PreferenceStore(file);
    await p1.addRecent('/a/b');
    await p1.update({ theme: 'dark', sidebarWidth: 10000 });
    const p2 = new PreferenceStore(file);
    expect(await p2.get()).toEqual({ theme: 'dark', sidebarWidth: 640, recentWorkspaces: ['/a/b'] });
    expect((await p2.removeRecent('/a/b')).recentWorkspaces).toEqual([]);
  });
});
