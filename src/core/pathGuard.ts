import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class PathDenied extends Error {}

/**
 * Resolves `rel` beneath `base` and returns the absolute path. Rejects
 * absolute paths, traversal, NUL bytes, and any path in which a component is
 * a symlink (symlinks are never followed). Callers must re-run this at the
 * point of access.
 */
export async function resolveWithin(base: string, rel: string): Promise<string> {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new PathDenied('Invalid path.');
  if (path.isAbsolute(rel) || rel.includes('\\')) throw new PathDenied('Path must be relative to the package.');
  const segments = rel.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) throw new PathDenied('Path traversal is not allowed.');
  const target = path.join(base, ...segments);

  let realBase: string;
  try {
    realBase = await fs.realpath(base);
  } catch {
    throw new PathDenied('The package directory is no longer accessible.');
  }
  if (realBase !== path.resolve(base)) throw new PathDenied('The package directory path contains a symbolic link.');

  let real: string;
  try {
    real = await fs.realpath(target);
  } catch (e) {
    // A missing target is reported by the caller; its parent must still be inside the base.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return target;
    throw e;
  }
  if (real !== target) throw new PathDenied('Symbolic links are not followed.');
  return target;
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export const toPosix = (p: string) => p.split(path.sep).join('/');
