import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  DepCategory,
  DependencyDeclaration,
  Diagnostic,
  PackageRecord,
  PackageStatus,
  Person,
  TextEntry,
  UrlEntry,
  VersionConstraints,
  XmlNode,
} from '../shared/types';

export interface ManifestContext {
  id: string;
  manifestPath: string;
  packageDir: string;
  relativeDir: string;
  ignoredByCatkin: boolean;
}

const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

const FORMAT1_DEPS: Record<string, DepCategory[]> = {
  build_depend: ['build'],
  buildtool_depend: ['buildtool'],
  run_depend: ['runtime'],
  test_depend: ['test'],
  doc_depend: ['doc'],
};

const FORMAT2_DEPS: Record<string, DepCategory[]> = {
  depend: ['build', 'export', 'runtime'],
  build_depend: ['build'],
  build_export_depend: ['export'],
  buildtool_depend: ['buildtool'],
  buildtool_export_depend: ['buildtool', 'export'],
  exec_depend: ['runtime'],
  test_depend: ['test'],
  doc_depend: ['doc'],
};

const FORMAT3_GROUP_DEPS: Record<string, DepCategory[]> = {
  group_depend: ['build', 'export', 'runtime'],
};

const METADATA_TAGS = new Set(['name', 'version', 'description', 'maintainer', 'author', 'license', 'url']);
const PASSTHROUGH_TAGS = new Set(['export', 'conflict', 'replace']);
const VERSION_ATTRS = ['version_lt', 'version_lte', 'version_eq', 'version_gte', 'version_gt'] as const;

class LimitError extends Error {}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/**
 * Blanks out a DOCTYPE (including any internal subset) so that entity
 * declarations can never be expanded. Newlines are preserved for line numbers.
 */
export function stripDoctype(text: string): { text: string; found: boolean } {
  const start = text.search(/<!DOCTYPE/i);
  if (start < 0) return { text, found: false };
  let i = start + 9;
  let quote: string | null = null;
  let inSubset = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') inSubset = true;
    else if (c === ']') inSubset = false;
    else if (c === '>' && !inSubset) break;
  }
  const end = Math.min(i + 1, text.length);
  const blanked = text.slice(start, end).replace(/[^\n]/g, ' ');
  return { text: text.slice(0, start) + blanked + text.slice(end), found: true };
}

function convert(items: unknown[], depth: number, counter: { n: number }): { children: XmlNode[]; text: string } {
  if (depth > MAX_DEPTH) throw new LimitError(`element nesting exceeds ${MAX_DEPTH} levels`);
  const children: XmlNode[] = [];
  let text = '';
  for (const item of items as Record<string, unknown>[]) {
    const key = Object.keys(item).find((k) => k !== ':@');
    if (key === undefined) continue;
    if (key === '#text') {
      text += String(item[key]);
      continue;
    }
    if (++counter.n > MAX_NODES) throw new LimitError(`more than ${MAX_NODES} elements`);
    const rawAttrs = (item[':@'] ?? {}) as Record<string, string>;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAttrs)) attrs[k.replace(/^@_/, '')] = String(v);
    const sub = convert(item[key] as unknown[], depth + 1, counter);
    children.push({ tag: key, attrs, text: sub.text, children: sub.children });
    text += sub.text;
  }
  return { children, text };
}

/** `text` already holds all descendant text in document order. */
const fullText = (node: XmlNode): string => node.text;

const clean = (s: string) => s.replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function emptyRecord(ctx: ManifestContext): PackageRecord {
  return {
    id: ctx.id,
    manifestPath: ctx.manifestPath,
    packageDir: ctx.packageDir,
    relativeDir: ctx.relativeDir,
    label: ctx.relativeDir,
    status: 'invalid',
    indexed: false,
    format: null,
    maintainers: [],
    authors: [],
    licenses: [],
    urls: [],
    buildTools: [],
    deps: [],
    memberOfGroups: [],
    exportElements: [],
    unknownElements: [],
    ignoredByCatkin: ctx.ignoredByCatkin,
    diagnostics: [],
  };
}

export function failedRecord(
  ctx: ManifestContext,
  status: Extract<PackageStatus, 'invalid' | 'unreadable'>,
  diag: Omit<Diagnostic, 'path' | 'packageId'>,
): PackageRecord {
  const rec = emptyRecord(ctx);
  rec.status = status;
  rec.diagnostics.push({ ...diag, path: ctx.manifestPath, packageId: ctx.id });
  return rec;
}

export function parseManifest(source: string, ctx: ManifestContext): PackageRecord {
  const rec = emptyRecord(ctx);
  const diag = (category: Diagnostic['category'], severity: Diagnostic['severity'], message: string, line?: number) =>
    rec.diagnostics.push({ category, severity, path: ctx.manifestPath, packageId: ctx.id, message, line });
  const fail = (message: string, line?: number): PackageRecord => {
    diag('parse', 'error', message, line);
    rec.status = 'invalid';
    return rec;
  };

  let text = source.replace(/^\uFEFF/, '');
  const stripped = stripDoctype(text);
  text = stripped.text;
  if (stripped.found) {
    diag('parse', 'warning', 'DOCTYPE and entity declarations were ignored; external entities are never resolved.');
  }

  const valid = XMLValidator.validate(text);
  if (valid !== true) return fail(`Malformed XML: ${valid.err.msg}`, valid.err.line);

  let roots: XmlNode[];
  try {
    roots = convert(parser.parse(text) as unknown[], 0, { n: 0 }).children;
  } catch (e) {
    return fail(`Could not parse XML: ${e instanceof Error ? e.message : String(e)}`);
  }
  const root = roots[0];
  if (!root) return fail('The manifest has no root element.');
  if (root.tag !== 'package') return fail(`Root element is <${root.tag}>, expected <package>.`);

  const formatAttr = root.attrs.format;
  const format = formatAttr === undefined ? 1 : /^\d+$/.test(formatAttr.trim()) ? Number(formatAttr.trim()) : NaN;
  if (format !== 1 && format !== 2 && format !== 3) {
    diag('validation', 'error', `Unsupported package format "${formatAttr}"; supported formats are 1, 2 and 3.`);
    rec.status = 'unsupported';
    return rec;
  }
  rec.format = format;
  if (formatAttr === undefined) {
    diag('validation', 'info', 'No format attribute; treated as format 1.');
  }

  const depTable = format === 1 ? FORMAT1_DEPS : FORMAT2_DEPS;
  const groupTable = format === 3 ? FORMAT3_GROUP_DEPS : {};
  const condition = (n: XmlNode) => (n.attrs.condition !== undefined ? n.attrs.condition : undefined);
  const first: Record<string, XmlNode | undefined> = {};

  for (const node of root.children) {
    const tag = node.tag;
    if (node.attrs.condition !== undefined && format !== 3) {
      diag('validation', 'warning', `<${tag}> has a condition attribute, which is only defined in format 3.`);
    }
    const isMember = format === 3 && tag === 'member_of_group';
    if (Object.hasOwn(depTable, tag) || Object.hasOwn(groupTable, tag) || isMember) {
      const name = node.text.trim();
      if (!name) {
        diag('validation', 'error', `<${tag}> has an empty name.`);
        continue;
      }
      const constraints: VersionConstraints = {};
      for (const a of VERSION_ATTRS) if (node.attrs[a] !== undefined) constraints[a] = node.attrs[a];
      const kind = isMember ? 'group-member' : Object.hasOwn(groupTable, tag) ? 'group-depend' : 'package';
      const cond = condition(node);
      if (kind === 'group-member') {
        rec.memberOfGroups.push(name);
        continue;
      }
      const dep: DependencyDeclaration = {
        tag,
        name,
        kind,
        categories: [...(depTable[tag] ?? groupTable[tag])],
        constraints,
        condition: cond,
        evaluation: cond === undefined ? 'unconditional' : 'not-evaluated',
      };
      rec.deps.push(dep);
      if (tag === 'buildtool_depend' || tag === 'buildtool_export_depend') rec.buildTools.push(name);
    } else if (METADATA_TAGS.has(tag)) {
      if (tag === 'name' || tag === 'version' || tag === 'description') {
        if (first[tag]) diag('validation', 'warning', `Multiple <${tag}> elements; only the first is used.`);
        else first[tag] = node;
      }
    } else if (PASSTHROUGH_TAGS.has(tag)) {
      if (tag === 'export') {
        if (first.export) diag('validation', 'warning', 'Multiple <export> elements; all are preserved.');
        first.export = node;
        rec.exportElements.push(...node.children);
      } else rec.unknownElements.push(node);
    } else {
      rec.unknownElements.push(node);
      diag('validation', 'warning', `Element <${tag}> is not defined in format ${format}; preserved but not interpreted.`);
    }
  }

  const nameNode = first.name;
  const name = nameNode ? nameNode.text.trim() : '';
  if (!name) diag('validation', 'error', 'Required <name> is missing or empty.');
  else {
    rec.name = name;
    rec.label = name;
    rec.indexed = true;
    if (!/^[a-z][a-z0-9_]*$/.test(name) || /__/.test(name) || name.endsWith('_')) {
      diag('validation', 'warning', `Package name "${name}" does not follow the naming convention (lowercase letters, digits and single underscores).`);
    }
  }

  const versionNode = first.version;
  const version = versionNode ? versionNode.text.trim() : '';
  if (!version) diag('validation', 'error', 'Required <version> is missing or empty.');
  else {
    rec.version = version;
    if (!/^\d+\.\d+\.\d+$/.test(version)) diag('validation', 'error', `Version "${version}" is not in MAJOR.MINOR.PATCH form.`);
  }

  const descNode = first.description;
  const description = descNode ? clean(fullText(descNode)) : '';
  if (!description) diag('validation', 'error', 'Required <description> is missing or empty.');
  else rec.description = description;

  const people = (tag: string): Person[] =>
    root.children
      .filter((n) => n.tag === tag)
      .map((n) => ({ name: clean(fullText(n)), email: n.attrs.email }))
      .filter((p) => p.name || p.email);
  rec.maintainers = people('maintainer');
  rec.authors = people('author');
  if (rec.maintainers.length === 0) diag('validation', 'error', 'At least one <maintainer> is required.');
  for (const m of rec.maintainers) {
    if (!m.email) diag('validation', 'error', `Maintainer "${m.name}" has no email attribute.`);
  }

  rec.licenses = root.children
    .filter((n) => n.tag === 'license')
    .map((n): TextEntry => ({ value: clean(fullText(n)), condition: condition(n) }))
    .filter((l) => l.value);
  if (rec.licenses.length === 0) diag('validation', 'error', 'At least one <license> is required.');

  rec.urls = root.children
    .filter((n) => n.tag === 'url')
    .map((n): UrlEntry => ({ url: clean(fullText(n)), type: n.attrs.type }))
    .filter((u) => u.url);

  if (format >= 2) {
    const bt = rec.exportElements.find((e) => e.tag === 'build_type');
    if (bt) rec.buildType = bt.text.trim() || undefined;
  }

  const hasError = rec.diagnostics.some((d) => d.severity === 'error');
  const hasWarning = rec.diagnostics.some((d) => d.severity === 'warning');
  rec.status = hasError ? 'invalid' : hasWarning ? 'warning' : 'ok';
  return rec;
}
