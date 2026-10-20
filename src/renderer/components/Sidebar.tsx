import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ListQuery } from '../../core/search';
import type { PackageRecord } from '../../shared/types';
import { useApp } from '../lib/context';
import { Badge, statusLabel, statusTone } from './ui';

interface Props {
  query: ListQuery;
  onQuery(q: ListQuery): void;
  items: PackageRecord[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}

const field = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm';

export function Sidebar({ query, onQuery, items, searchRef }: Props) {
  const { state, select, duplicates } = useApp();
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
    // Without layout (tests) fall back to a fixed window so rows still render.
    initialRect: { width: 300, height: 600 },
  });

  const selectedIndex = items.findIndex((p) => p.id === state.selectedId);
  useEffect(() => {
    if (selectedIndex >= 0) virt.scrollToIndex(selectedIndex, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedId]);

  const onKey = (e: KeyboardEvent) => {
    if (items.length === 0) return;
    let next = selectedIndex;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, selectedIndex + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, selectedIndex < 0 ? 0 : selectedIndex - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'PageDown') next = Math.min(items.length - 1, selectedIndex + 8);
    else if (e.key === 'PageUp') next = Math.max(0, selectedIndex - 8);
    else return;
    e.preventDefault();
    select(items[next].id, 'list');
  };

  const total = state.packages.length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <label className="sr-only" htmlFor="pkg-search">Search packages</label>
      <input
        id="pkg-search"
        ref={searchRef}
        type="search"
        placeholder="Search packages…  (Ctrl+F)"
        value={query.text}
        onChange={(e) => onQuery({ ...query, text: e.target.value })}
        className={`${field} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          Sort
          <select aria-label="Sort packages" className={field} value={query.sort} onChange={(e) => onQuery({ ...query, sort: e.target.value as ListQuery['sort'] })}>
            <option value="name">Name</option>
            <option value="path">Path</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Show
          <select aria-label="Filter by diagnostic status" className={field} value={query.status} onChange={(e) => onQuery({ ...query, status: e.target.value as ListQuery['status'] })}>
            <option value="all">All</option>
            <option value="problems">With problems</option>
            <option value="ok">Clean only</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={query.duplicatesOnly} disabled={!state.indexReady} onChange={(e) => onQuery({ ...query, duplicatesOnly: e.target.checked })} />
          Duplicate names
        </label>
      </div>
      <div className="text-xs text-muted-foreground" aria-live="polite">
        {items.length === total ? `${total} packages` : `${items.length} of ${total} packages`}
      </div>

      {items.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">
          {total === 0
            ? state.scan === 'scanning'
              ? 'Waiting for manifests…'
              : 'No packages.'
            : 'No packages match the current search and filters.'}
        </p>
      ) : (
        <div
          ref={parentRef}
          role="listbox"
          aria-label="Packages"
          tabIndex={0}
          aria-activedescendant={selectedIndex >= 0 ? `pkg-opt-${selectedIndex}` : undefined}
          onKeyDown={onKey}
          className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card"
        >
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((v) => {
              const p = items[v.index];
              const selected = p.id === state.selectedId;
              return (
                <div
                  key={p.id}
                  id={`pkg-opt-${v.index}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => select(p.id, 'list')}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}
                  className={`cursor-pointer border-b border-border px-3 py-1.5 ${selected ? 'bg-accent' : 'hover:bg-muted'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{p.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.version ? `v${p.version}` : ''}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-muted-foreground" title={p.relativeDir}>{p.relativeDir}</span>
                    <span className="flex shrink-0 gap-1">
                      {duplicates.has(p.id) && <Badge tone="warning">duplicate</Badge>}
                      {p.ignoredByCatkin && <Badge title="Beneath a CATKIN_IGNORE directory">ignored</Badge>}
                      {p.status !== 'ok' && <Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
