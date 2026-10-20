import { useCallback, useEffect, useState } from 'react';
import type { PackageRecord, PreviewResult } from '../../shared/types';
import { useApp } from '../lib/context';
import { PreviewBody } from './CodeView';
import { Badge, Button, Section } from './ui';

export function ManifestTab({ pkg }: { pkg: PackageRecord }) {
  const { state } = useApp();
  const scanId = state.scanId!;
  const [content, setContent] = useState<PreviewResult | 'loading'>('loading');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setContent('loading');
    setContent(await window.explorer.readManifest(scanId, pkg.id));
  }, [scanId, pkg.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const diagnostics = pkg.diagnostics;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Section title={`Diagnostics (${diagnostics.length})`}>
        {diagnostics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No diagnostics for this manifest.</p>
        ) : (
          <ul className="space-y-1">
            {diagnostics.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={d.severity === 'error' ? 'danger' : d.severity === 'warning' ? 'warning' : 'neutral'}>{d.severity}</Badge>
                <Badge>{d.category}</Badge>
                <span>{d.message}</span>
                {d.line !== undefined && <span className="text-xs text-muted-foreground">line {d.line}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="flex items-center gap-2">
        <Button
          onClick={async () => {
            const r = await window.explorer.openInVSCode(scanId, pkg.id, 'package.xml');
            setMsg(r.ok ? 'Opened.' : r.message);
          }}
        >
          Edit on VSCode
        </Button>
        {msg && <span role="status" className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <PreviewBody result={content} name="package.xml" onReload={() => void load()} />
      </div>
    </div>
  );
}
