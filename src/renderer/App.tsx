import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { filterPackages, toSearchEntries, type ListQuery } from '../core/search';
import { DEFAULT_PREFS, type Preferences } from '../shared/types';
import { Detail } from './components/Detail';
import { DiagnosticsDialog } from './components/DiagnosticsDialog';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Button, Notice } from './components/ui';
import { AppContext, type AppContextValue } from './lib/context';
import { initialState, reducer } from './lib/store';

const THEMES: Preferences['theme'][] = ['system', 'light', 'dark'];

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [query, setQuery] = useState<ListQuery>({ text: '', sort: 'name', status: 'all', duplicatesOnly: false });
  const [diagOpen, setDiagOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(DEFAULT_PREFS.sidebarWidth);

  useEffect(() => {
    void window.explorer.getPreferences().then((p) => {
      setPrefs(p);
      setWidth(p.sidebarWidth);
    });
    return window.explorer.onScanEvent((event) => dispatch({ type: 'scan-event', event }));
  }, []);

  useEffect(() => {
    const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const apply = () => document.documentElement.classList.toggle('dark', dark());
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme]);

  const open = useCallback(async (path?: string) => {
    setError(null);
    try {
      await window.explorer.openWorkspace(path);
      setPrefs(await window.explorer.getPreferences());
      setQuery((q) => ({ ...q, duplicatesOnly: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await window.explorer.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const byId = useMemo(() => new Map(state.packages.map((p) => [p.id, p])), [state.packages]);
  const duplicates = useMemo(() => new Set(state.index.duplicateIds), [state.index]);
  const entries = useMemo(() => toSearchEntries(state.packages), [state.packages]);
  const items = useMemo(() => filterPackages(entries, query, duplicates), [entries, query, duplicates]);

  const ctx: AppContextValue = useMemo(
    () => ({
      state,
      byId,
      duplicates,
      select: (id, mode) => dispatch({ type: 'select', id, mode }),
      back: () => dispatch({ type: 'back' }),
      forward: () => dispatch({ type: 'forward' }),
      setTab: (tab) => dispatch({ type: 'tab', tab }),
    }),
    [state, byId, duplicates],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') (e.preventDefault(), searchRef.current?.focus());
      else if (e.ctrlKey && e.key.toLowerCase() === 'o') (e.preventDefault(), void open());
      else if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) (e.preventDefault(), void refresh());
      else if (e.altKey && e.key === 'ArrowLeft') dispatch({ type: 'back' });
      else if (e.altKey && e.key === 'ArrowRight') dispatch({ type: 'forward' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, refresh]);

  const cycleTheme = async () => {
    const next = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
    setPrefs(await window.explorer.setPreferences({ theme: next }));
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.min(640, Math.max(220, startW + ev.clientX - startX));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void window.explorer.setPreferences({ sidebarWidth: w });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const resizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = Math.min(640, Math.max(220, width + (e.key === 'ArrowRight' ? 20 : -20)));
    setWidth(w);
    void window.explorer.setPreferences({ sidebarWidth: w });
  };

  const { packages, scan, progress } = state;
  const warnings = packages.filter((p) => p.status === 'warning').length;
  const invalid = packages.filter((p) => p.status === 'invalid' || p.status === 'unsupported' || p.status === 'unreadable').length;
  const statusText =
    scan === 'idle' ? '' :
    scan === 'scanning' ? `Scanning… ${progress.directoriesVisited} directories visited, ${progress.manifestsFound} manifests found` :
    scan === 'complete' ? 'Scan complete' :
    scan === 'partial' ? 'Scan partial — some paths could not be read' :
    scan === 'cancelled' ? 'Scan cancelled — results are incomplete' :
    'Scan failed';

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <Header
          root={state.root}
          scan={scan}
          statusText={statusText}
          prefs={prefs}
          onOpen={(p) => void open(p)}
          onRefresh={() => void refresh()}
          onCancel={() => void window.explorer.cancelScan()}
          onTheme={() => void cycleTheme()}
          onRemoveRecent={(p) => void window.explorer.removeRecent(p).then(setPrefs)}
        />
        {error && <div className="p-2"><Notice tone="danger">{error}</Notice></div>}
        {scan === 'partial' && (
          <div className="p-2"><Notice tone="warning">Partial scan: some directories or manifests could not be read, so this list may be missing packages. See diagnostics.</Notice></div>
        )}
        {scan === 'cancelled' && (
          <div className="p-2"><Notice tone="warning">Scan cancelled. The {packages.length} packages shown are incomplete; refresh to scan again.</Notice></div>
        )}
        {scan === 'failed' && (
          <div className="p-2"><Notice tone="danger">Workspace not accessible{state.scanError ? `: ${state.scanError}` : '.'} Results shown (if any) are incomplete.</Notice></div>
        )}

        {state.root === null ? (
          <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <h2 className="text-2xl font-semibold">Explore ROS packages offline</h2>
            <p className="max-w-lg text-muted-foreground">
              Choose a workspace folder (or its <code>src</code> directory). Every <code>package.xml</code> beneath it is discovered; nothing is built, executed, or modified.
            </p>
            <Button variant="primary" onClick={() => void open()}>Open workspace</Button>
          </main>
        ) : scan !== 'scanning' && packages.length === 0 && scan !== 'failed' ? (
          <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <h2 className="text-xl font-semibold">{scan === 'cancelled' ? 'Scan cancelled before any package was found' : 'No package.xml files found'}</h2>
            <p className="text-muted-foreground">{progress.directoriesVisited} directories were searched in {state.root}.</p>
          </main>
        ) : (
          <div className="flex min-h-0 flex-1">
            <aside style={{ width }} className="shrink-0 border-r border-border" aria-label="Package list">
              <Sidebar query={query} onQuery={setQuery} items={items} searchRef={searchRef} />
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize package list"
              aria-valuenow={width}
              aria-valuemin={220}
              aria-valuemax={640}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={resizeKey}
              className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary"
            />
            <main className="min-w-0 flex-1">
              <Detail />
            </main>
          </div>
        )}

        <footer className="flex items-center gap-4 border-t border-border bg-card px-4 py-1.5 text-xs">
          <span>{packages.length} packages</span>
          <span>{warnings} warnings</span>
          <span>{invalid} invalid manifests</span>
          {state.indexReady && state.index.unindexedCount > 0 && <span className="text-muted-foreground">{state.index.unindexedCount} excluded from dependency matching</span>}
          <Button variant="ghost" className="ml-auto !py-0.5 text-xs" onClick={() => setDiagOpen(true)} disabled={state.root === null}>
            View diagnostics ({state.diagnostics.filter((d) => d.severity !== 'info').length})
          </Button>
        </footer>
        <DiagnosticsDialog open={diagOpen} onClose={() => setDiagOpen(false)} />
      </div>
    </AppContext.Provider>
  );
}
