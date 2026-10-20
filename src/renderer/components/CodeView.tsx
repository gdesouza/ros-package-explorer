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

type Lang = { comment: string; keywords: string };
const kw = (w: string) => `\\b(?:${w.split(' ').join('|')})\\b`;
const HASH_COMMENT = '#[^\\n]*';
const LANGS = {
  cpp: {
    comment: '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|^[ \\t]*#[ \\t]*\\w+',
    keywords: kw('auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for if include inline int long namespace new nullptr operator override private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'),
  },
  py: {
    comment: HASH_COMMENT,
    keywords: kw('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self'),
  },
  yaml: { comment: HASH_COMMENT, keywords: kw('true false null yes no') },
  cmake: {
    comment: HASH_COMMENT,
    keywords: kw('if else elseif endif foreach endforeach function endfunction macro endmacro while endwhile return set project cmake_minimum_required find_package add_executable add_library catkin_package catkin_python_setup target_link_libraries include_directories install add_dependencies add_message_files add_service_files generate_messages'),
  },
  json: { comment: '\\/\\/[^\\n]*', keywords: kw('true false null') },
  msg: { comment: HASH_COMMENT, keywords: kw('bool int8 uint8 int16 uint16 int32 uint32 int64 uint64 float32 float64 string time duration char byte Header') },
} satisfies Record<string, Lang>;

function langFor(name: string): Lang | undefined {
  const n = name.toLowerCase();
  if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx|cu)$/.test(n)) return LANGS.cpp;
  if (/\.pyi?$/.test(n)) return LANGS.py;
  if (/\.(ya?ml|rviz)$/.test(n)) return LANGS.yaml;
  if (/(^|\/)cmakelists\.txt$|\.cmake$/.test(n)) return LANGS.cmake;
  if (/\.jsonc?$/.test(n)) return LANGS.json;
  if (/\.(msg|srv|action)$/.test(n)) return LANGS.msg;
  return undefined;
}

const STRING = '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'';
const tokenCache = new Map<Lang, RegExp>();
function tokenRe(lang: Lang): RegExp {
  let re = tokenCache.get(lang);
  if (!re) {
    re = new RegExp(`(${lang.comment})|(${STRING})|(${lang.keywords})|(\\b\\d[\\w.]*\\b)`, 'gm');
    tokenCache.set(lang, re);
  }
  return re;
}

/** Produces React text nodes only; file content is never interpreted as markup. */
export function highlightCode(text: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  const classes = ['xml-comment', 'xml-str', 'xml-tag', 'xml-attr'];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(tokenRe(lang))) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const g = m.findIndex((v, i) => i > 0 && v !== undefined) - 1;
    out.push(<span key={k++} className={classes[g]}>{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const XMLISH = /\.(xml|launch|urdf|xacro|sdf|test|xsd|svg)$/i;

export function CodeView({ text, name, label }: { text: string; name: string; label: string }) {
  const content = useMemo(() => {
    if (text.length > HIGHLIGHT_LIMIT) return text;
    if (XMLISH.test(name)) return highlightXml(text);
    const lang = langFor(name);
    return lang ? highlightCode(text, lang) : text;
  }, [text, name]);
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
