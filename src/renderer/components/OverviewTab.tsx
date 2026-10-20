import type { PackageRecord, XmlNode } from '../../shared/types';
import { useApp } from '../lib/context';
import { Badge, Button, Section, statusLabel, statusTone } from './ui';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[9rem_1fr] gap-2 py-1">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </div>
);

const none = <span className="text-muted-foreground">Not declared</span>;

function XmlList({ nodes }: { nodes: XmlNode[] }) {
  return (
    <ul className="space-y-1 font-mono text-xs">
      {nodes.map((n, i) => (
        <li key={i} className="rounded border border-border bg-card px-2 py-1">
          <span className="text-primary">&lt;{n.tag}&gt;</span>
          {Object.entries(n.attrs).map(([k, v]) => (
            <span key={k} className="ml-2">
              <span className="text-success">{k}</span>=&quot;{v}&quot;
            </span>
          ))}
          {n.text.trim() && <span className="ml-2 text-muted-foreground">{n.text.trim().slice(0, 300)}</span>}
        </li>
      ))}
    </ul>
  );
}

export function OverviewTab({ pkg }: { pkg: PackageRecord }) {
  const { state, duplicates, setTab } = useApp();
  const errors = pkg.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = pkg.diagnostics.filter((d) => d.severity === 'warning').length;
  const evidence = [pkg.buildType && `build type: ${pkg.buildType}`, pkg.buildTools.length > 0 && `build tools: ${pkg.buildTools.join(', ')}`].filter(Boolean);
  const open = (url: string) => void window.explorer.openExternal(url);

  return (
    <div>
      {pkg.status === 'unsupported' || (pkg.format === null && !pkg.indexed) ? (
        <p className="mb-4 rounded-md border border-danger p-3 text-sm text-danger" role="alert">
          This manifest could not be interpreted ({statusLabel(pkg.status).toLowerCase()}). Metadata below is unavailable; open the Manifest tab for the original content and diagnostics.
        </p>
      ) : null}
      <Section title="Description">
        {pkg.description ? <p className="whitespace-pre-wrap">{pkg.description}</p> : none}
      </Section>
      <Section title="Details">
        <dl>
          <Row label="Manifest format">{pkg.format ?? none}</Row>
          <Row label="Version">{pkg.version ?? none}</Row>
          <Row label="Maintainers">
            {pkg.maintainers.length ? (
              <ul>{pkg.maintainers.map((m, i) => <li key={i}>{m.name}{m.email && <span className="text-muted-foreground"> &lt;{m.email}&gt;</span>}</li>)}</ul>
            ) : none}
          </Row>
          <Row label="Authors">
            {pkg.authors.length ? (
              <ul>{pkg.authors.map((m, i) => <li key={i}>{m.name}{m.email && <span className="text-muted-foreground"> &lt;{m.email}&gt;</span>}</li>)}</ul>
            ) : none}
          </Row>
          <Row label="Licenses">
            {pkg.licenses.length ? (
              <ul>{pkg.licenses.map((l, i) => <li key={i}>{l.value}{l.condition && <span className="text-muted-foreground"> (condition: {l.condition} — not evaluated)</span>}</li>)}</ul>
            ) : none}
          </Row>
          <Row label="URLs">
            {pkg.urls.length ? (
              <ul>
                {pkg.urls.map((u, i) => (
                  <li key={i}>
                    {/^https?:\/\//i.test(u.url) ? (
                      <button type="button" className="text-primary underline" onClick={() => open(u.url)}>{u.url}</button>
                    ) : (
                      u.url
                    )}
                    {u.type && <span className="text-muted-foreground"> ({u.type})</span>}
                  </li>
                ))}
              </ul>
            ) : none}
          </Row>
          <Row label="Build evidence">
            {evidence.length ? evidence.join(' · ') : <span className="text-muted-foreground">None declared; the manifest alone does not show which ROS version or build system applies.</span>}
          </Row>
          <Row label="Manifest path"><span className="font-mono text-xs">{pkg.manifestPath}</span></Row>
          <Row label="Status">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(pkg.status)}>{statusLabel(pkg.status)}</Badge>
              {errors > 0 && <span>{errors} error{errors > 1 ? 's' : ''}</span>}
              {warnings > 0 && <span>{warnings} warning{warnings > 1 ? 's' : ''}</span>}
              {pkg.diagnostics.length > 0 && <Button variant="ghost" onClick={() => setTab('manifest')}>View diagnostics</Button>}
              {pkg.ignoredByCatkin && <Badge>Ignored by catkin discovery (CATKIN_IGNORE)</Badge>}
              {duplicates.has(pkg.id) && <Badge tone="warning">Name shared with other packages</Badge>}
            </span>
          </Row>
        </dl>
      </Section>
      {pkg.exportElements.length > 0 && (
        <Section title="Export elements" note="Preserved from the manifest as declared.">
          <XmlList nodes={pkg.exportElements} />
        </Section>
      )}
      {pkg.unknownElements.length > 0 && (
        <Section title="Other elements" note="Elements without a dedicated view are preserved, not interpreted.">
          <XmlList nodes={pkg.unknownElements} />
        </Section>
      )}
      <p className="text-xs text-muted-foreground">
        Shown from manifest declarations only{state.scan === 'scanning' ? '; the scan is still running' : ''}. A manifest does not prove this is a ROS 1 or buildable package.
      </p>
    </div>
  );
}
