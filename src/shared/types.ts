export const PREVIEW_LIMIT_BYTES = 1024 * 1024;
export const MANIFEST_LIMIT_BYTES = 1024 * 1024;
export const MAX_DIR_ENTRIES = 5000;

export type Severity = 'error' | 'warning' | 'info';
export type DiagnosticCategory = 'discovery' | 'parse' | 'validation';

export interface Diagnostic {
  category: DiagnosticCategory;
  severity: Severity;
  /** Absolute path affected. */
  path: string;
  message: string;
  packageId?: string;
  line?: number;
}

export type PackageStatus = 'ok' | 'warning' | 'invalid' | 'unsupported' | 'unreadable';

export type DepCategory = 'build' | 'buildtool' | 'export' | 'runtime' | 'test' | 'doc';

export type VersionConstraints = Partial<
  Record<'version_lt' | 'version_lte' | 'version_eq' | 'version_gte' | 'version_gt', string>
>;

export interface DependencyDeclaration {
  /** Original XML tag, e.g. `depend`, `run_depend`, `group_depend`. */
  tag: string;
  /** Package name, or group name for group_depend / member_of_group. */
  name: string;
  kind: 'package' | 'group-depend' | 'group-member';
  categories: DepCategory[];
  constraints: VersionConstraints;
  condition?: string;
  evaluation: 'not-evaluated' | 'unconditional';
}

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  /** All descendant text in document order. */
  text: string;
  children: XmlNode[];
}

/** `sourceIndex` is the entry's position among same-tag elements in the manifest, used for editing. */
export interface Person {
  name: string;
  email?: string;
  sourceIndex: number;
}

export interface UrlEntry {
  url: string;
  type?: string;
  sourceIndex: number;
}

export interface TextEntry {
  value: string;
  condition?: string;
  sourceIndex: number;
}

export interface PackageRecord {
  /** Manifest location relative to the workspace root, POSIX separators. */
  id: string;
  manifestPath: string;
  packageDir: string;
  /** Package directory relative to the workspace root ('.' for the root). */
  relativeDir: string;
  /** Name, or the relative directory as fallback. */
  label: string;
  status: PackageStatus;
  /** True when the manifest was parsed well enough to take part in name matching. */
  indexed: boolean;
  format: number | null;
  name?: string;
  version?: string;
  description?: string;
  maintainers: Person[];
  authors: Person[];
  licenses: TextEntry[];
  urls: UrlEntry[];
  buildTools: string[];
  buildType?: string;
  deps: DependencyDeclaration[];
  /** Groups this package declares membership of. */
  memberOfGroups: string[];
  exportElements: XmlNode[];
  unknownElements: XmlNode[];
  ignoredByCatkin: boolean;
  diagnostics: Diagnostic[];
}

export type ScanState = 'idle' | 'scanning' | 'complete' | 'partial' | 'cancelled' | 'failed';

export interface ScanProgress {
  directoriesVisited: number;
  manifestsFound: number;
  skippedLinks: number;
  currentDirectory?: string;
}

export interface ReverseRef {
  sourceId: string;
  tag: string;
  categories: DepCategory[];
  condition?: string;
  evaluation: DependencyDeclaration['evaluation'];
  /** The source name resolves to several packages, so this edge may point elsewhere. */
  ambiguous: boolean;
}

export interface DependencyIndex {
  /** Declared package name -> ids of indexed packages with that name. */
  byName: Record<string, string[]>;
  /** Package id -> declarations elsewhere in the scan that name it. */
  reverse: Record<string, ReverseRef[]>;
  /** Group name -> ids of packages declaring membership. */
  groupMembers: Record<string, string[]>;
  duplicateIds: string[];
  /** Number of manifests excluded because they could not be parsed. */
  unindexedCount: number;
}

export type ScanEvent =
  | { type: 'started'; scanId: number; root: string }
  | { type: 'progress'; scanId: number; progress: ScanProgress }
  | { type: 'batch'; scanId: number; packages: PackageRecord[]; diagnostics: Diagnostic[] }
  | { type: 'index'; scanId: number; index: DependencyIndex }
  | { type: 'finished'; scanId: number; state: Exclude<ScanState, 'idle' | 'scanning'>; progress: ScanProgress; error?: string };

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  sidebarWidth: number;
  recentWorkspaces: string[];
}

export interface WorkspaceInfo {
  scanId: number;
  root: string;
}

export const DEFAULT_PREFS: Preferences = { theme: 'system', sidebarWidth: 340, recentWorkspaces: [] };

export interface DirEntry {
  name: string;
  /** Path relative to the package directory, POSIX separators. */
  path: string;
  kind: 'dir' | 'file' | 'symlink' | 'other';
  size?: number;
  mtimeMs?: number;
}

export type DirListing =
  | { state: 'ok'; entries: DirEntry[]; truncated: boolean }
  | { state: 'missing' | 'unreadable' | 'stale' | 'denied' | 'not-directory'; message: string };

export type PreviewResult =
  | { state: 'text'; text: string; size: number; mtimeMs: number; changed: boolean }
  | { state: 'too-large'; size: number; mtimeMs: number; limit: number }
  | { state: 'binary'; size: number; mtimeMs: number }
  | { state: 'missing' | 'unreadable' | 'stale' | 'denied' | 'symlink' | 'not-file'; message: string };

export interface ExpectedStat {
  size: number;
  mtimeMs: number;
}

export interface ManifestEdit {
  tag: 'version' | 'description' | 'maintainer' | 'author' | 'license' | 'url';
  /** Position among the manifest's direct children with this tag; one past the end appends. */
  index: number;
  text: string;
  /** Only for maintainer and author; an empty string removes the attribute. */
  email?: string;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export interface ExplorerApi {
  openWorkspace(path?: string): Promise<WorkspaceInfo | null>;
  refresh(): Promise<WorkspaceInfo | null>;
  cancelScan(): Promise<void>;
  onScanEvent(cb: (event: ScanEvent) => void): () => void;
  readManifest(scanId: number, packageId: string): Promise<PreviewResult>;
  listDirectory(scanId: number, packageId: string, relPath: string): Promise<DirListing>;
  previewFile(scanId: number, packageId: string, relPath: string, expected?: ExpectedStat): Promise<PreviewResult>;
  copyPath(scanId: number, packageId: string, relPath: string): Promise<ActionResult>;
  showInFolder(scanId: number, packageId: string, relPath: string): Promise<ActionResult>;
  openExternal(url: string): Promise<ActionResult>;
  updateManifest(scanId: number, packageId: string, edit: ManifestEdit): Promise<ActionResult>;
  getPreferences(): Promise<Preferences>;
  setPreferences(patch: Partial<Omit<Preferences, 'recentWorkspaces'>>): Promise<Preferences>;
  removeRecent(path: string): Promise<Preferences>;
}

declare global {
  interface Window {
    explorer: ExplorerApi;
  }
}
