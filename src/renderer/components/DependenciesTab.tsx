import { useState } from 'react';
import type { DepCategory, DependencyDeclaration, PackageRecord } from '../../shared/types';
import { useApp } from '../lib/context';
import { Badge, Notice, Section } from './ui';

const CATS: { id: DepCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'build', label: 'Build' },
  { id: 'buildtool', label: 'Build tool' },
  { id: 'export', label: 'Export' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'test', label: 'Test' },
  { id: 'doc', label: 'Doc' },
];
const catLabel = (c: DepCategory) => CATS.find((x) => x.id === c)!.label;

export function PackageLink({ id }: { id: string }) {
  const { byId, select } = useApp();
  const p = byId.get(id);
  return (
    <button type="button" className="text-left text-primary underline" onClick={() => select(id, 'link')}>
      {p?.label ?? id}
      <span className="ml-1 font-mono text-xs text-muted-foreground no-underline">{p?.relativeDir}</span>
    </button>
  );
}

const constraintText = (d: DependencyDeclaration) =>
  Object.entries(d.constraints)
    .map(([k, v]) => `${k.replace('version_', '').replace('lte', '≤').replace('gte', '≥').replace('lt', '<').replace('gt', '>').replace('eq', '=')} ${v}`)
    .join(', ');

function Match({ dep }: { dep: DependencyDeclaration }) {
  const { state } = useApp();
  if (!state.indexReady) return <span className="text-muted-foreground">Available when the scan finishes</span>;
  const ids = state.index.byName[dep.name] ?? [];
  if (ids.length === 0) return <span className="text-muted-foreground">Not found in scanned workspace</span>;
  if (ids.length === 1) return <PackageLink id={ids[0]} />;
  return (
    <div>
      <span className="text-warning">{ids.length} packages share this name — choose one:</span>
      <ul className="mt-1 space-y-0.5">
        {ids.map((id) => (
          <li key={id}><PackageLink id={id} /></li>
        ))}
      </ul>
    </div>
  );
}

const Cond = ({ d }: { d: DependencyDeclaration }) =>
  d.condition === undefined ? <span className="text-muted-foreground">—</span> : (
    <span>
      <code className="font-mono text-xs">{d.condition}</code>
      <span className="ml-1 text-xs text-warning">Not evaluated</span>
    </span>
  );

export function DependenciesTab({ pkg }: { pkg: PackageRecord }) {
  const { state } = useApp();
  const [cat, setCat] = useState<DepCategory | 'all'>('all');
  const pkgDeps = pkg.deps.filter((d) => d.kind === 'package' && (cat === 'all' || d.categories.includes(cat)));
  const groupDeps = pkg.deps.filter((d) => d.kind === 'group-depend' && (cat === 'all' || d.categories.includes(cat)));
  const reverse = state.index.reverse[pkg.id] ?? [];
  const th = 'px-2 py-1 text-left text-xs font-semibold text-muted-foreground';
  const td = 'px-2 py-1.5 align-top';

  return (
    <div>
      <Notice>
        Manifest declarations only — not a build graph. Conditions are not evaluated, system dependency keys are not resolved, and
        matching is by package name across the scanned workspace.
      </Notice>
      {!pkg.indexed && (
        <div className="mt-3">
          <Notice tone="warning">
            This manifest could not be parsed or has no usable name, so it is excluded from dependency matching and reverse dependencies.
          </Notice>
        </div>
      )}

      <div role="group" aria-label="Filter by category" className="my-4 flex flex-wrap gap-1.5">
        {CATS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={cat === c.id}
            onClick={() => setCat(c.id)}
            className={`rounded-full border px-3 py-0.5 text-xs ${cat === c.id ? 'border-primary bg-accent' : 'border-border hover:bg-muted'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Section title={`Declared dependencies (${pkgDeps.length})`}>
        {pkgDeps.length === 0 ? (
          <p className="text-sm text-muted-foreground">None declared{cat !== 'all' ? ' in this category' : ''}.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Name</th>
                <th className={th}>Declared as</th>
                <th className={th}>Categories</th>
                <th className={th}>Version</th>
                <th className={th}>Condition</th>
                <th className={th}>In scanned workspace</th>
              </tr>
            </thead>
            <tbody>
              {pkgDeps.map((d, i) => (
                <tr key={i} className="border-b border-border">
                  <td className={`${td} font-medium`}>{d.name}</td>
                  <td className={`${td} font-mono text-xs`}>&lt;{d.tag}&gt;</td>
                  <td className={td}><span className="flex flex-wrap gap-1">{d.categories.map((c) => <Badge key={c}>{catLabel(c)}</Badge>)}</span></td>
                  <td className={td}>{constraintText(d) || <span className="text-muted-foreground">—</span>}</td>
                  <td className={td}><Cond d={d} /></td>
                  <td className={td}><Match dep={d} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {(groupDeps.length > 0 || pkg.memberOfGroups.length > 0) && (
        <Section title="Groups" note="Groups are separate from package names and are never matched to packages.">
          {groupDeps.map((d, i) => (
            <div key={i} className="mb-2">
              <div>
                Depends on group <strong>{d.name}</strong> <span className="font-mono text-xs">&lt;{d.tag}&gt;</span>
                {d.condition !== undefined && <> · <Cond d={d} /></>}
              </div>
              <div className="ml-4 text-xs text-muted-foreground">
                {state.indexReady ? (
                  (state.index.groupMembers[d.name] ?? []).length === 0 ? 'No scanned package declares membership.' : (
                    <ul className="space-y-0.5 text-sm">
                      {state.index.groupMembers[d.name].map((id) => <li key={id}><PackageLink id={id} /></li>)}
                    </ul>
                  )
                ) : 'Members available when the scan finishes.'}
              </div>
            </div>
          ))}
          {pkg.memberOfGroups.length > 0 && (
            <div>Member of: {pkg.memberOfGroups.map((g) => <Badge key={g}>{g}</Badge>)}</div>
          )}
        </Section>
      )}

      <Section title={`Required by (${state.indexReady ? reverse.length : '…'})`} note="Other scanned manifests that declare this package's name.">
        {!state.indexReady ? (
          <p className="text-sm text-muted-foreground">Available when the scan finishes.</p>
        ) : reverse.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scanned manifest declares this name.</p>
        ) : (
          <ul className="space-y-1.5">
            {reverse.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <PackageLink id={r.sourceId} />
                <span className="font-mono text-xs">&lt;{r.tag}&gt;</span>
                {r.categories.map((c) => <Badge key={c}>{catLabel(c)}</Badge>)}
                {r.condition !== undefined && <span className="text-xs text-warning">conditional · Not evaluated</span>}
                {r.ambiguous && <Badge tone="warning" title="The declared name matches several scanned packages">ambiguous name</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
