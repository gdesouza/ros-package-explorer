import { useMemo, type ReactNode } from 'react';
import type { PreviewResult } from '../../shared/types';
import { Button, Notice, formatBytes } from './ui';

const XML_TOKEN = /(<!--[\s\S]*?-->)|(<\/?)([\w:.-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?>)/g;
const ATTR = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')?/g;
const HIGHLIGHT_LIMIT = 300_000;

/** Produces React text nodes only; file content is never interpreted as markup. */
export function highlightXml(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(XML_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1]) out.push(<span key={k++} className="xml-comment">{m[1]}</span>);
    else {
      const attrs: ReactNode[] = [];
      let al = 0;
      const raw = m[4] ?? '';
      for (const a of raw.matchAll(ATTR)) {
        const ai = a.index ?? 0;
        if (ai > al) attrs.push(raw.slice(al, ai));
        attrs.push(<span key={`n${ai}`} className="xml-attr">{a[1]}</span>);
        attrs.push(a[2]);
        if (a[3]) attrs.push(<span key={`v${ai}`} className="xml-str">{a[3]}</span>);
        al = ai + a[0].length;
      }
      if (al < raw.length) attrs.push(raw.slice(al));
      out.push(
        <span key={k++}>
          {m[2]}
          <span className="xml-tag">{m[3]}</span>
          {attrs}
          {m[5]}
        </span>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const XMLISH = /\.(xml|launch|urdf|xacro|sdf|test|xsd|svg)$/i;

export function CodeView({ text, name, label }: { text: string; name: string; label: string }) {
  const content = useMemo(
    () => (XMLISH.test(name) && text.length <= HIGHLIGHT_LIMIT ? highlightXml(text) : text),
    [text, name],
  );
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="h-full min-h-0 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed whitespace-pre"
    >
      {content}
    </pre>
  );
}

export function PreviewBody({
  result,
  name,
  onReload,
}: {
  result: PreviewResult | 'loading';
  name: string;
  onReload: () => void;
}) {
  if (result === 'loading') return <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  switch (result.state) {
    case 'text':
      return (
        <div className="flex h-full min-h-0 flex-col gap-2">
          {result.changed && (
            <Notice tone="warning">
              This file changed on disk since it was listed. The content below was read just now.{' '}
              <Button variant="ghost" onClick={onReload}>Reload</Button>
            </Notice>
          )}
          <div className="min-h-0 flex-1">
            <CodeView text={result.text} name={name} label={`Contents of ${name}`} />
          </div>
        </div>
      );
    case 'too-large':
      return (
        <Notice tone="warning">
          Not previewed: {formatBytes(result.size)} exceeds the {formatBytes(result.limit)} preview limit.
        </Notice>
      );
    case 'binary':
      return (
        <Notice>
          Binary file — {formatBytes(result.size)}, modified {new Date(result.mtimeMs).toLocaleString()}. No text preview.
        </Notice>
      );
    default:
      return (
        <Notice tone="danger">
          {result.message}{' '}
          {result.state !== 'denied' && result.state !== 'symlink' && (
            <Button variant="ghost" onClick={onReload}>Retry</Button>
          )}
        </Notice>
      );
  }
}
