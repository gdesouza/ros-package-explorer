import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { useApp } from '../lib/context';
import type { TabId } from '../lib/store';
import { DependenciesTab } from './DependenciesTab';
import { FilesTab } from './FilesTab';
import { ManifestTab } from './ManifestTab';
import { OverviewTab } from './OverviewTab';
import { Badge, Button, statusLabel, statusTone } from './ui';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'files', label: 'Files' },
  { id: 'manifest', label: 'Manifest' },
];

export function Detail() {
  const { state, byId, duplicates, back, forward, setTab } = useApp();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pkg = state.selectedId ? byId.get(state.selectedId) : undefined;

  if (!pkg) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
        {state.packages.length === 0 ? 'Packages will appear here.' : 'Select a package to see its metadata, dependencies and files.'}
      </div>
    );
  }

  const onKey = (e: KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[n].id);
    tabRefs.current[n]?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-5 pt-4">
        <div className="flex items-start gap-2">
          <div className="flex gap-1">
            <Button variant="ghost" aria-label="Back" title="Back (Alt+Left)" disabled={state.historyPos <= 0} onClick={back}><ArrowLeft size={16} /></Button>
            <Button variant="ghost" aria-label="Forward" title="Forward (Alt+Right)" disabled={state.historyPos >= state.history.length - 1} onClick={forward}><ArrowRight size={16} /></Button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{pkg.label}</h2>
              {pkg.version && <span className="text-muted-foreground">v{pkg.version}</span>}
              <Badge tone={statusTone(pkg.status)}>{statusLabel(pkg.status)}</Badge>
              {duplicates.has(pkg.id) && <Badge tone="warning">duplicate name</Badge>}
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground" title={pkg.packageDir}>{pkg.relativeDir}</div>
          </div>
        </div>
        <div role="tablist" aria-label="Package details" className="mt-3 flex gap-1">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => void (tabRefs.current[i] = el)}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={state.tab === t.id}
              aria-controls="tab-panel"
              tabIndex={state.tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${state.tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${state.tab}`} className="min-h-0 flex-1 overflow-auto p-5">
        {state.tab === 'overview' && <OverviewTab key={pkg.id} pkg={pkg} />}
        {state.tab === 'dependencies' && <DependenciesTab key={pkg.id} pkg={pkg} />}
        {state.tab === 'files' && <FilesTab key={`${state.scanId}:${pkg.id}`} pkg={pkg} />}
        {state.tab === 'manifest' && <ManifestTab key={`${state.scanId}:${pkg.id}`} pkg={pkg} />}
      </div>
    </div>
  );
}
