import { useEffect, useMemo, useRef, useState } from 'react';
import type { Diagnostic, Severity } from '../../shared/types';
import { useApp } from '../lib/context';
import { Badge, Button } from './ui';

const CAP = 1000;

export function DiagnosticsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { state, byId, select } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [min, setMin] = useState<'warning' | 'info'>('warning');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  const shown = useMemo(() => {
    const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    const limit = min === 'warning' ? 1 : 2;
    return state.diagnostics.filter((d) => rank[d.severity] <= limit);
  }, [state.diagnostics, min]);

  const rel = (d: Diagnostic) => (state.root && d.path.startsWith(state.root) ? d.path.slice(state.root.length + 1) || '.' : d.path);

  return (
    <dialog
      ref={ref}
      aria-label="Diagnostics"
      onClose={onClose}
      className="m-auto h-[80vh] w-[min(56rem,92vw)] rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">Diagnostics</h2>
          <label className="ml-auto text-sm">
            Show{' '}
            <select className="rounded-md border border-border bg-card px-2 py-1" value={min} onChange={(e) => setMin(e.target.value as 'warning' | 'info')}>
              <option value="warning">Errors and warnings</option>
              <option value="info">Everything (incl. skipped links)</option>
            </select>
          </label>
          <Button onClick={onClose}>Close</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No diagnostics to show.</p>
          ) : (
            <ul className="space-y-2">
              {shown.slice(0, CAP).map((d, i) => (
                <li key={i} className="rounded-md border border-border p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.severity === 'error' ? 'danger' : d.severity === 'warning' ? 'warning' : 'neutral'}>{d.severity}</Badge>
                    <Badge>{d.category}</Badge>
                    <span>{d.message}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate" title={d.path}>{rel(d)}</span>
                    {d.packageId && byId.has(d.packageId) && (
                      <button
                        type="button"
                        className="font-sans text-primary underline"
                        onClick={() => {
                          select(d.packageId!, 'list');
                          onClose();
                        }}
                      >
                        Go to package
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.length > CAP && <p className="mt-2 text-xs text-muted-foreground">Showing the first {CAP} of {shown.length}.</p>}
        </div>
      </div>
    </dialog>
  );
}
