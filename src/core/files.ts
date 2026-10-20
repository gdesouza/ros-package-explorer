import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  MAX_DIR_ENTRIES,
  PREVIEW_LIMIT_BYTES,
  type DirEntry,
  type DirListing,
  type ExpectedStat,
  type PreviewResult,
} from '../shared/types';
import { PathDenied, resolveWithin } from './pathGuard';

const errState = (e: unknown): { state: 'missing' | 'unreadable'; message: string } => {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return { state: 'missing', message: 'The file no longer exists.' };
  return { state: 'unreadable', message: `Cannot read: ${(e as Error).message}` };
};

export async function listDirectory(packageDir: string, rel: string): Promise<DirListing> {
  let abs: string;
  try {
    abs = await resolveWithin(packageDir, rel);
  } catch (e) {
    if (e instanceof PathDenied) return { state: 'denied', message: e.message };
    return errState(e);
  }
  try {
    const dirents = await fsp.readdir(abs, { withFileTypes: true });
    dirents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const truncated = dirents.length > MAX_DIR_ENTRIES;
    const entries: DirEntry[] = await Promise.all(
      dirents.slice(0, MAX_DIR_ENTRIES).map(async (d): Promise<DirEntry> => {
        const kind = d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'symlink' : d.isFile() ? 'file' : 'other';
        const entry: DirEntry = { name: d.name, path: rel === '' || rel === '.' ? d.name : `${rel}/${d.name}`, kind };
        if (kind === 'file') {
          try {
            const st = await fsp.lstat(path.join(abs, d.name));
            entry.size = st.size;
            entry.mtimeMs = st.mtimeMs;
          } catch {
            // Listed but vanished; leave metadata empty and let preview report it.
          }
        }
        return entry;
      }),
    );
    return { state: 'ok', entries, truncated };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR') return { state: 'not-directory', message: 'Not a directory.' };
    return errState(e);
  }
}

function looksBinary(buf: Buffer): boolean {
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return false;
  } catch {
    // A cut multi-byte sequence at the end of a truncated read is not binary evidence.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, Math.max(0, buf.length - 3)));
      return false;
    } catch {
      return true;
    }
  }
}

export async function readPreview(
  packageDir: string,
  rel: string,
  expected?: ExpectedStat,
  limit = PREVIEW_LIMIT_BYTES,
): Promise<PreviewResult> {
  let abs: string;
  try {
    abs = await resolveWithin(packageDir, rel);
  } catch (e) {
    if (e instanceof PathDenied) return { state: 'denied', message: e.message };
    return errState(e);
  }

  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = await handle.stat();
    if (!st.isFile()) return { state: 'not-file', message: 'Not a regular file.' };
    if (st.size > limit) return { state: 'too-large', size: st.size, mtimeMs: st.mtimeMs, limit };

    // Read at most limit + 1 bytes so a file that grew after stat() is still bounded.
    const buf = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < buf.length) {
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > limit) return { state: 'too-large', size: Math.max(st.size, total), mtimeMs: st.mtimeMs, limit };
    const data = buf.subarray(0, total);
    if (looksBinary(data)) return { state: 'binary', size: total, mtimeMs: st.mtimeMs };
    const changed = !!expected && (expected.size !== st.size || expected.mtimeMs !== st.mtimeMs);
    return { state: 'text', text: data.toString('utf8'), size: total, mtimeMs: st.mtimeMs, changed };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') return { state: 'symlink', message: 'Symbolic links are not followed.' };
    return errState(e);
  } finally {
    await handle?.close();
  }
}
