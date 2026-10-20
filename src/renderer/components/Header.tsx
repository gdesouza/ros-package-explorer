import { FolderOpen, Monitor, Moon, RefreshCw, Sun, X } from 'lucide-react';
import { useState } from 'react';
import type { Preferences, ScanState } from '../../shared/types';
import { Button } from './ui';

interface Props {
  root: string | null;
  scan: ScanState;
  statusText: string;
  prefs: Preferences;
  onOpen(path?: string): void;
  onRefresh(): void;
  onCancel(): void;
  onTheme(): void;
  onRemoveRecent(path: string): void;
}

export function Header({ root, scan, statusText, prefs, onOpen, onRefresh, onCancel, onTheme, onRemoveRecent }: Props) {
  const [recentOpen, setRecentOpen] = useState(false);
  const ThemeIcon = prefs.theme === 'light' ? Sun : prefs.theme === 'dark' ? Moon : Monitor;
  return (
    <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
      <h1 className="text-base font-semibold whitespace-nowrap">ROS Package Explorer</h1>
      <div className="relative flex gap-2">
        <Button variant="primary" onClick={() => onOpen()} title="Open workspace (Ctrl+O)">
          <FolderOpen size={16} aria-hidden /> Open workspace
        </Button>
        <Button
          aria-haspopup="true"
          aria-expanded={recentOpen}
          onClick={() => setRecentOpen((v) => !v)}
          disabled={prefs.recentWorkspaces.length === 0}
        >
          Recent
        </Button>
        {recentOpen && (
          <div
            role="menu"
            aria-label="Recent workspaces"
            className="absolute top-full left-0 z-20 mt-1 w-[28rem] rounded-md border border-border bg-card p-1 shadow-lg"
            onKeyDown={(e) => e.key === 'Escape' && setRecentOpen(false)}
          >
            {prefs.recentWorkspaces.map((p) => (
              <div key={p} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-accent"
                  title={p}
                  onClick={() => {
                    setRecentOpen(false);
                    onOpen(p);
                  }}
                >
                  {p}
                </button>
                <button type="button" aria-label={`Remove ${p} from recent`} className="rounded p-1.5 hover:bg-accent" onClick={() => onRemoveRecent(p)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button onClick={onRefresh} disabled={!root} title="Refresh (F5)">
          <RefreshCw size={16} aria-hidden /> Refresh
        </Button>
        {scan === 'scanning' && <Button onClick={onCancel}>Cancel scan</Button>}
      </div>
      <div className="ml-auto flex min-w-0 flex-col items-end">
        <span className="max-w-[32rem] truncate font-mono text-xs text-muted-foreground" title={root ?? undefined}>{root ?? 'No workspace selected'}</span>
        <span className="text-xs" role="status">{statusText}</span>
      </div>
      <Button variant="ghost" onClick={onTheme} aria-label={`Theme: ${prefs.theme}. Click to change.`} title={`Theme: ${prefs.theme}`}>
        <ThemeIcon size={16} aria-hidden />
      </Button>
    </header>
  );
}
