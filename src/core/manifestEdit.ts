import { stripDoctype } from './manifest';
import type { ManifestEdit } from '../shared/types';

export const EDITABLE_TAGS = ['version', 'description', 'maintainer', 'author', 'license', 'url'] as const;
const EMAIL_TAGS = new Set(['maintainer', 'author']);
const MAX_TEXT = 20_000;

export class EditError extends Error {}

interface Span {
  tag: string;
  start: number;
  /** Index just after the start tag's `>`. */
  contentStart: number;
  /** Index of `</tag>`; equals `end` for self-closing elements. */
  contentEnd: number;
  end: number;
  selfClosing: boolean;
}

/** Locates the direct children of the root element without altering any source text. */
function locate(source: string): { children: Span[]; rootClose: number } {
  const s = stripDoctype(source).text;
  const children: Span[] = [];
  const stack: Span[] = [];
  let rootClose = -1;
  let i = 0;
  const skip = (open: string, close: string) => {
    const e = s.indexOf(close, i + open.length);
    if (e < 0) throw new EditError('The manifest is malformed.');
    i = e + close.length;
  };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (s.startsWith('<!--', i)) skip('<!--', '-->');
    else if (s.startsWith('<![CDATA[', i)) skip('<![CDATA[', ']]>');
    else if (s.startsWith('<?', i)) skip('<?', '?>');
    else if (s.startsWith('<!', i)) skip('<!', '>');
    else if (s.startsWith('</', i)) {
      const gt = s.indexOf('>', i);
      if (gt < 0) throw new EditError('The manifest is malformed.');
      const span = stack.pop();
      if (!span) throw new EditError('The manifest is malformed.');
      span.contentEnd = i;
      span.end = gt + 1;
      if (stack.length === 1) children.push(span);
      else if (stack.length === 0) rootClose = i;
      i = gt + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(s.slice(i, i + 256));
      if (!m) throw new EditError('The manifest is malformed.');
      let j = i + m[0].length;
      let quote: string | null = null;
      for (; j < s.length; j++) {
        const c = s[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      if (j >= s.length) throw new EditError('The manifest is malformed.');
      const selfClosing = s[j - 1] === '/';
      const span: Span = { tag: m[1], start: i, contentStart: j + 1, contentEnd: j + 1, end: j + 1, selfClosing };
      i = j + 1;
      if (selfClosing) {
        if (stack.length === 1) children.push(span);
        else if (stack.length === 0) rootClose = -1;
      } else stack.push(span);
    }
  }
  if (stack.length !== 0 || rootClose < 0) throw new EditError('The manifest is malformed.');
  return { children, rootClose };
}

const escapeText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (t: string) => escapeText(t).replace(/"/g, '&quot;');

function setEmail(startTag: string, email: string): string {
  const attr = /\s+email\s*=\s*("[^"]*"|'[^']*')/;
  if (!email) return startTag.replace(attr, '');
  if (attr.test(startTag)) return startTag.replace(attr, () => ` email="${escapeAttr(email)}"`);
  return startTag.replace(/\s*(\/?>)$/, (_m, end: string) => ` email="${escapeAttr(email)}"${end}`);
}

/**
 * Replaces the text of one direct child of `<package>` (or appends it when
 * `edit.index` is one past the last), leaving every other byte untouched.
 */
export function applyManifestEdit(source: string, edit: ManifestEdit): string {
  if (!(EDITABLE_TAGS as readonly string[]).includes(edit.tag)) throw new EditError(`<${edit.tag}> cannot be edited.`);
  if (!Number.isSafeInteger(edit.index) || edit.index < 0) throw new EditError('Invalid element index.');
  if (typeof edit.text !== 'string' || edit.text.length > MAX_TEXT || edit.text.includes('\0')) throw new EditError('Invalid value.');
  const email = EMAIL_TAGS.has(edit.tag) && typeof edit.email === 'string' ? edit.email.trim() : undefined;
  if (email !== undefined && (email.length > 512 || /[\r\n\0]/.test(email))) throw new EditError('Invalid email.');
  const text = edit.tag === 'description' ? edit.text.trim() : edit.text.replace(/\s+/g, ' ').trim();
  if (!text && edit.tag !== 'description') throw new EditError('The value cannot be empty.');

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const body = escapeText(text).replace(/\r?\n/g, eol);
  const { children, rootClose } = locate(source);
  const matches = children.filter((c) => c.tag === edit.tag);
  if (edit.index > matches.length) throw new EditError('The manifest changed; refresh and try again.');

  if (edit.index === matches.length) {
    const lineStart = source.lastIndexOf('\n', rootClose) + 1;
    const indent = /^[ \t]*$/.test(source.slice(lineStart, rootClose)) ? source.slice(lineStart, rootClose) : '';
    const startTag = email === undefined ? `<${edit.tag}>` : setEmail(`<${edit.tag}>`, email);
    const el = `${startTag}${body}</${edit.tag}>`;
    if (indent || lineStart === rootClose) return source.slice(0, rootClose) + `  ${el}${eol}${indent}` + source.slice(rootClose);
    return source.slice(0, rootClose) + el + source.slice(rootClose);
  }

  const span = matches[edit.index];
  let startTag = source.slice(span.start, span.contentStart);
  if (email !== undefined) startTag = setEmail(startTag, email);
  if (span.selfClosing) startTag = startTag.replace(/\s*\/>$/, '>');
  return source.slice(0, span.start) + startTag + body + `</${edit.tag}>` + source.slice(span.end);
}
