// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import { buildDependencyIndex } from '../src/core/depIndex';
import { parseManifest } from '../src/core/manifest';
import { manifest } from './helpers';
import { DEFAULT_PREFS, type ExplorerApi, type PackageRecord, type ScanEvent } from '../src/shared/types';

const rec = (dir: string, xml: string): PackageRecord =>
  parseManifest(xml, { id: `${dir}/package.xml`, manifestPath: `/ws/${dir}/package.xml`, packageDir: `/ws/${dir}`, relativeDir: dir, ignoredByCatkin: false });

function mockApi() {
  let listener: (e: ScanEvent) => void = () => {};
  const packages = [
    rec('src/alpha', manifest('alpha', '<depend>beta</depend><depend>absent</depend>')),
    rec('src/beta', manifest('beta')),
    rec('src/bad', '<package><name>x</package>'),
  ];
  const api: ExplorerApi = {
    openWorkspace: vi.fn(async () => {
      const emit = (e: ScanEvent) => listener(e);
      emit({ type: 'started', scanId: 1, root: '/ws' });
      emit({ type: 'batch', scanId: 1, packages, diagnostics: packages.flatMap((p) => p.diagnostics) });
      emit({ type: 'index', scanId: 1, index: buildDependencyIndex(packages) });
      emit({ type: 'finished', scanId: 1, state: 'complete', progress: { directoriesVisited: 4, manifestsFound: 3, skippedLinks: 0 } });
      return { scanId: 1, root: '/ws' };
    }),
    refresh: vi.fn(async () => null),
    cancelScan: vi.fn(async () => {}),
    onScanEvent: (cb) => ((listener = cb), () => {}),
    readManifest: vi.fn(async () => ({ state: 'text' as const, text: '<package format="2"/>', size: 20, mtimeMs: 1, changed: false })),
    listDirectory: vi.fn(async () => ({ state: 'ok' as const, entries: [{ name: 'package.xml', path: 'package.xml', kind: 'file' as const, size: 20, mtimeMs: 1 }], truncated: false })),
    previewFile: vi.fn(async () => ({ state: 'text' as const, text: 'hello world', size: 11, mtimeMs: 1, changed: false })),
    copyPath: vi.fn(async () => ({ ok: true as const })),
    showInFolder: vi.fn(async () => ({ ok: true as const })),
    openExternal: vi.fn(async () => ({ ok: true as const })),
    updateManifest: vi.fn(async () => ({ ok: true as const })),
    getPreferences: vi.fn(async () => DEFAULT_PREFS),
    setPreferences: vi.fn(async (p) => ({ ...DEFAULT_PREFS, ...p })),
    removeRecent: vi.fn(async () => DEFAULT_PREFS),
  };
  return api;
}

beforeEach(() => {
  // jsdom has no layout; give the virtualized list a viewport.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 56 });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.explorer = mockApi();
});
afterEach(cleanup);

describe('renderer smoke path', () => {
  it('opens a workspace, selects a package and inspects overview, dependencies, files and manifest', async () => {
    render(<App />);
    expect(screen.getByText(/Explore ROS packages offline/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Open workspace/ })[0]);

    const list = await screen.findByRole('listbox', { name: 'Packages' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
    expect(screen.getByText('Scan complete')).toBeTruthy();
    expect(screen.getByText('1 invalid manifests')).toBeTruthy();

    fireEvent.click(within(list).getByText('alpha'));
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Dependencies' }));
    expect(screen.getByText('Not found in scanned workspace')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    expect(screen.getByRole('heading', { name: 'beta' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(await screen.findByRole('treeitem', { name: /package.xml/ }));
    expect(await screen.findByText('hello world')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Manifest' }));
    expect(await screen.findByText(/package/, { selector: '.xml-tag' })).toBeTruthy();
  });

  it('keeps search text while switching packages and reports empty results', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open workspace/ })[0]);
    const list = await screen.findByRole('listbox', { name: 'Packages' });
    const search = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'ALP' } });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1));
    fireEvent.click(within(list).getByText('alpha'));
    expect(search.value).toBe('ALP');
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText(/No packages match/)).toBeTruthy();
  });

  it('keeps unparseable manifests visible with their relative path label', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open workspace/ })[0]);
    const list = await screen.findByRole('listbox', { name: 'Packages' });
    fireEvent.click(await within(list).findByText('src/bad', { selector: 'span.truncate.font-medium' }));
    expect(screen.getByRole('heading', { name: 'src/bad' })).toBeTruthy();
    expect(screen.getByText(/could not be interpreted/)).toBeTruthy();
  });
});

describe('inline metadata editing', () => {
  it('edits a field through the pencil and reports failures', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open workspace/ })[0]);
    const list = await screen.findByRole('listbox', { name: 'Packages' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
    fireEvent.click(within(list).getByText('alpha'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit version' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'version' }), { target: { value: '1.2.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(window.explorer.updateManifest).toHaveBeenCalledWith(1, 'src/alpha/package.xml', { tag: 'version', index: 0, text: '1.2.3' }));

    vi.mocked(window.explorer.updateManifest).mockResolvedValueOnce({ ok: false, message: 'nope' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit maintainer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'maintainer email' }), { target: { value: 'x@y.z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'maintainer' })).toBeNull();
  });
});
