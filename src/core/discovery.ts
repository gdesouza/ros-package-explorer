import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { MANIFEST_LIMIT_BYTES, type Diagnostic, type PackageRecord, type ScanProgress, type ScanState } from '../shared/types';
import { failedRecord, parseManifest, type ManifestContext } from './manifest';
import { toPosix } from './pathGuard';

export interface DiscoveryHooks {
  cancelled: () => boolean;
  onPackage: (record: PackageRecord) => void;
  onDiagnostic: (diagnostic: Diagnostic) => void;
  onProgress: (progress: ScanProgress) => void;
}

export interface DiscoveryResult {
  state: Extract<ScanState, 'complete' | 'partial' | 'cancelled'>;
  progress: ScanProgress;
}

async function readManifestText(file: string): Promise<{ kind: 'text'; text: string } | { kind: 'too-large'; size: number }> {
  const handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.size > MANIFEST_LIMIT_BYTES) return { kind: 'too-large', size: st.size };
    const buf = Buffer.alloc(MANIFEST_LIMIT_BYTES + 1);
    let total = 0;
    while (total < buf.length) {
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MANIFEST_LIMIT_BYTES) return { kind: 'too-large', size: total };
    return { kind: 'text', text: buf.subarray(0, total).toString('utf8') };
  } finally {
    await handle.close();
  }
}

/**
 * Exhaustively walks `root` (already canonical) for regular files named
 * `package.xml`. Symlinks are reported and never followed. Recursion continues
 * below directories that contain a manifest.
 */
export async function discover(root: string, hooks: DiscoveryHooks): Promise<DiscoveryResult> {
  const progress: ScanProgress = { directoriesVisited: 0, manifestsFound: 0, skippedLinks: 0 };
  let partial = false;
  const stack: { dir: string; ignored: boolean }[] = [{ dir: root, ignored: false }];

  const discoveryDiag = (severity: Diagnostic['severity'], p: string, message: string) =>
    hooks.onDiagnostic({ category: 'discovery', severity, path: p, message });

  while (stack.length > 0) {
    if (hooks.cancelled()) return { state: 'cancelled', progress };
    const { dir, ignored: parentIgnored } = stack.pop()!;

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      partial = true;
      discoveryDiag('error', dir, `Cannot read directory: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
      progress.directoriesVisited++;
      hooks.onProgress({ ...progress, currentDirectory: dir });
      continue;
    }
    progress.directoriesVisited++;
    progress.currentDirectory = dir;

    const ignored = parentIgnored || entries.some((d) => d.name === 'CATKIN_IGNORE');
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const subdirs: string[] = [];
    let manifest: fs.Dirent | undefined;
    for (const d of entries) {
      const full = path.join(dir, d.name);
      if (d.isSymbolicLink()) {
        progress.skippedLinks++;
        discoveryDiag('info', full, 'Symbolic link skipped (links are not followed).');
      } else if (d.isDirectory()) subdirs.push(full);
      else if (d.isFile() && d.name === 'package.xml') manifest = d;
    }
    // Reverse so that popping from the stack visits directories in name order.
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push({ dir: subdirs[i], ignored });

    if (manifest) {
      const manifestPath = path.join(dir, manifest.name);
      const rel = toPosix(path.relative(root, manifestPath));
      const relDir = toPosix(path.relative(root, dir)) || '.';
      const ctx: ManifestContext = { id: rel, manifestPath, packageDir: dir, relativeDir: relDir, ignoredByCatkin: ignored };
      progress.manifestsFound++;
      let record: PackageRecord;
      try {
        const read = await readManifestText(manifestPath);
        if (read.kind === 'too-large') {
          record = failedRecord(ctx, 'invalid', {
            category: 'parse',
            severity: 'error',
            message: `Manifest is ${read.size} bytes, which exceeds the ${MANIFEST_LIMIT_BYTES}-byte limit; it was not parsed.`,
          });
        } else record = parseManifest(read.text, ctx);
      } catch (e) {
        partial = true;
        record = failedRecord(ctx, 'unreadable', {
          category: 'discovery',
          severity: 'error',
          message: `Cannot read manifest: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`,
        });
      }
      if (ignored) {
        record.diagnostics.push({
          category: 'discovery',
          severity: 'info',
          path: manifestPath,
          packageId: rel,
          message: 'Beneath a CATKIN_IGNORE directory; catkin package discovery would skip this package.',
        });
      }
      hooks.onPackage(record);
    }
    hooks.onProgress({ ...progress });
  }

  return { state: partial ? 'partial' : 'complete', progress };
}
