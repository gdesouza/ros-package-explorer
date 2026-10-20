import { ChevronDown, ChevronRight, File as FileIcon, Folder, Link2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirEntry, DirListing, PackageRecord, PreviewResult } from '../../shared/types';
import { useApp } from '../lib/context';
import { PreviewBody } from './CodeView';
import { Button, Notice, formatBytes } from './ui';

type Listing = DirListing | 'loading';

export function FilesTab({ pkg }: { pkg: PackageRecord }) {
  const { state } = useApp();
  const scanId = state.scanId!;
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<DirEntry | null>(null);
  const [preview, setPreview] = useState<PreviewResult | 'loading'>('loading');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const previewSeq = useRef(0);

  const load = useCallback(
    async (dir: string) => {
      setListings((l) => ({ ...l, [dir]: 'loading' }));
      const result = await window.explorer.listDirectory(scanId, pkg.id, dir);
      setListings((l) => ({ ...l, [dir]: result }));
    },
    [scanId, pkg.id],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const toggle = (dir: string) => {
    const next = new Set(expanded);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      void load(dir); // re-list on every expand so stale directory contents are never shown
    }
    setExpanded(next);
  };

  const openPreview = useCallback(
    async (entry: DirEntry) => {
      const seq = ++previewSeq.current;
      setPreview('loading');
      const expected = entry.size !== undefined && entry.mtimeMs !== undefined ? { size: entry.size, mtimeMs: entry.mtimeMs } : undefined;
      const result = await window.explorer.previewFile(scanId, pkg.id, entry.path, expected);
      if (seq === previewSeq.current) setPreview(result);
    },
    [scanId, pkg.id],
  );

  const choose = (entry: DirEntry) => {
    setSelected(entry);
    setActionMsg(null);
    if (entry.kind === 'file') void openPreview(entry);
    else if (entry.kind === 'symlink') setPreview({ state: 'symlink', message: 'Symbolic links are not followed or previewed.' });
    else setPreview({ state: 'not-file', message: 'Not a regular file.' });
  };

  const act = async (kind: 'copy' | 'show' | 'vscode') => {
    const rel = selected?.path ?? '';
    const r =
      kind === 'copy'
        ? await window.explorer.copyPath(scanId, pkg.id, rel)
        : kind === 'vscode'
          ? await window.explorer.openInVSCode(scanId, pkg.id, rel)
          : await window.explorer.showInFolder(scanId, pkg.id, rel);
    setActionMsg(r.ok ? (kind === 'copy' ? 'Path copied.' : 'Opened.') : r.message);
  };

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const l = listings[dir];
    if (l === undefined || l === 'loading') return <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 16 + 8 }}>Loading…</li>;
    if (l.state !== 'ok') {
      return <li className="py-1 text-xs text-danger" role="alert" style={{ paddingLeft: depth * 16 + 8 }}>{l.message}</li>;
    }
    return (
      <>
        {l.entries.length === 0 && <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 16 + 8 }}>Empty directory</li>}
        {l.entries.map((e) => (
          <li key={e.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={e.kind === 'dir' ? expanded.has(e.path) : undefined}
              aria-selected={selected?.path === e.path}
              onClick={() => (e.kind === 'dir' ? (toggle(e.path), setSelected(e), setPreview({ state: 'not-file', message: 'Select a file to preview it.' })) : choose(e))}
              className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm ${selected?.path === e.path ? 'bg-accent' : 'hover:bg-muted'}`}
              style={{ paddingLeft: depth * 16 + 4 }}
            >
              {e.kind === 'dir' ? (
                expanded.has(e.path) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />
              ) : (
                <span className="w-3.5" />
              )}
              {e.kind === 'dir' ? <Folder size={14} aria-hidden /> : e.kind === 'symlink' ? <Link2 size={14} aria-hidden /> : <FileIcon size={14} aria-hidden />}
              <span className="truncate">{e.name}</span>
              {e.kind === 'symlink' && <span className="ml-1 text-xs text-muted-foreground">(link, not followed)</span>}
            </button>
            {e.kind === 'dir' && expanded.has(e.path) && <ul role="group">{renderDir(e.path, depth + 1)}</ul>}
          </li>
        ))}
        {l.truncated && <li className="py-1 text-xs text-warning" style={{ paddingLeft: depth * 16 + 8 }}>Listing truncated to the first entries.</li>}
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="w-72 shrink-0 overflow-auto rounded-md border border-border bg-card p-1">
        <ul role="tree" aria-label={`Files in ${pkg.label}`}>{renderDir('', 0)}</ul>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground">{selected ? selected.path : '(package root)'}</span>
          {selected?.size !== undefined && <span className="text-xs text-muted-foreground">{formatBytes(selected.size)}</span>}
          <span className="ml-auto flex gap-2">
            {selected?.kind === 'file' && <Button onClick={() => void act('vscode')}>Edit on VSCode</Button>}
            <Button onClick={() => void act('copy')}>Copy path</Button>
            <Button onClick={() => void act('show')}>{selected && selected.kind !== 'dir' ? 'Open containing folder' : 'Open folder'}</Button>
          </span>
        </div>
        {actionMsg && <div role="status" className="text-xs text-muted-foreground">{actionMsg}</div>}
        <div className="min-h-0 flex-1">
          {selected ? (
            <PreviewBody result={preview} name={selected.name} onReload={() => selected.kind === 'file' && void openPreview(selected)} />
          ) : (
            <Notice>Select a file to preview it. Files are read-only and nothing is executed.</Notice>
          )}
        </div>
      </div>
    </div>
  );
}
