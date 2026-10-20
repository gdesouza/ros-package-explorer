import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDependencyIndex } from '../src/core/depIndex';
import { discover } from '../src/core/discovery';
import { listDirectory, readPreview } from '../src/core/files';
import { PathDenied, resolveWithin } from '../src/core/pathGuard';
import { filterPackages, toSearchEntries } from '../src/core/search';
import type { Diagnostic, PackageRecord } from '../src/shared/types';
import { manifest } from './helpers';

let tmp: string;
const w = (rel: string, content: string | Buffer = '') => {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};

async function scan(root: string, cancelAfterDirs?: number) {
  const packages: PackageRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  let dirs = 0;
  const result = await discover(root, {
    cancelled: () => cancelAfterDirs !== undefined && dirs >= cancelAfterDirs,
    onPackage: (p) => packages.push(p),
    onDiagnostic: (d) => diagnostics.push(d),
    onProgress: (p) => (dirs = p.directoriesVisited),
  });
  return { packages, diagnostics, result };
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rpe-')));
  w('package.xml', manifest('root_pkg', '<depend>nested</depend><depend>dup</depend><depend>absent_dep</depend>'));
  w('nested/package.xml', manifest('nested', '<depend>root_pkg</depend><member_of_group>g1</member_of_group>', 3));
  w('.hidden/h/package.xml', manifest('hidden_pkg'));
  w('build/gen/package.xml', manifest('generated'));
  w('ign/CATKIN_IGNORE');
  w('ign/deep/package.xml', manifest('ignored_pkg'));
  w('d1/package.xml', manifest('dup'));
  w('d2/package.xml', manifest('dup'));
  w('bad/package.xml', '<package><name>x</package>');
  w('v9/package.xml', '<package format="9"/>');
  w('big/package.xml', 'x'.repeat(1024 * 1024 + 10));
  w('group/package.xml', manifest('grp', '<group_depend>g1</group_depend>', 3));
  fs.symlinkSync(tmp, path.join(tmp, 'loop'));
  fs.symlinkSync('/etc', path.join(tmp, 'escape'));
  w('linkman/real.xml', manifest('linked'));
  fs.symlinkSync(path.join(tmp, 'linkman/real.xml'), path.join(tmp, 'linkman/package.xml'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('discovery', () => {
  it('finds every regular package.xml, including hidden, generated and nested, and annotates CATKIN_IGNORE', async () => {
    const { packages, result } = await scan(tmp);
    const ids = packages.map((p) => p.id).sort();
    expect(ids).toEqual(
      ['.hidden/h/package.xml', 'bad/package.xml', 'big/package.xml', 'build/gen/package.xml', 'd1/package.xml', 'd2/package.xml', 'group/package.xml', 'ign/deep/package.xml', 'nested/package.xml', 'package.xml', 'v9/package.xml'].sort(),
    );
    expect(packages.find((p) => p.id === 'ign/deep/package.xml')?.ignoredByCatkin).toBe(true);
    expect(packages.find((p) => p.id === 'd1/package.xml')?.ignoredByCatkin).toBe(false);
    expect(result.state).toBe('complete');
  });

  it('does not follow symlinks, reports them, and never visits outside the root', async () => {
    const { packages, diagnostics, result } = await scan(tmp);
    expect(packages.some((p) => p.id.startsWith('loop') || p.id.startsWith('escape'))).toBe(false);
    expect(packages.some((p) => p.id === 'linkman/package.xml')).toBe(false);
    const skipped = diagnostics.filter((d) => d.message.includes('Symbolic link skipped')).map((d) => path.basename(d.path));
    expect(skipped).toEqual(expect.arrayContaining(['loop', 'escape', 'package.xml']));
    expect(result.progress.skippedLinks).toBe(3);
  });

  it('keeps malformed, unsupported and oversized manifests visible with distinct diagnostics', async () => {
    const { packages } = await scan(tmp);
    const get = (id: string) => packages.find((p) => p.id === id)!;
    expect(get('bad/package.xml').diagnostics[0].message).toMatch(/Malformed XML/);
    expect(get('v9/package.xml').status).toBe('unsupported');
    expect(get('big/package.xml').diagnostics[0].message).toMatch(/exceeds/);
    expect(get('big/package.xml').label).toBe('big');
  });

  it.skipIf(process.getuid?.() === 0)('continues past unreadable manifests and subtrees and reports partial', async () => {
    w('locked/package.xml', manifest('locked'));
    w('lockeddir/inner/package.xml', manifest('inner'));
    fs.chmodSync(path.join(tmp, 'locked/package.xml'), 0o000);
    fs.chmodSync(path.join(tmp, 'lockeddir'), 0o000);
    try {
      const { packages, diagnostics, result } = await scan(tmp);
      expect(result.state).toBe('partial');
      expect(packages.find((p) => p.id === 'locked/package.xml')?.status).toBe('unreadable');
      expect(packages.some((p) => p.id === 'package.xml')).toBe(true);
      expect(diagnostics.some((d) => d.severity === 'error' && d.path.endsWith('lockeddir'))).toBe(true);
    } finally {
      fs.chmodSync(path.join(tmp, 'locked/package.xml'), 0o644);
      fs.chmodSync(path.join(tmp, 'lockeddir'), 0o755);
      fs.rmSync(path.join(tmp, 'locked'), { recursive: true });
      fs.rmSync(path.join(tmp, 'lockeddir'), { recursive: true });
    }
  });

  it('stops cooperatively when cancelled', async () => {
    const { result } = await scan(tmp, 2);
    expect(result.state).toBe('cancelled');
  });
});

describe('dependency index and search', () => {
  it('matches by name, flags duplicates and ambiguity, and keeps groups separate', async () => {
    const { packages } = await scan(tmp);
    const idx = buildDependencyIndex(packages);
    expect(idx.byName.dup.sort()).toEqual(['d1/package.xml', 'd2/package.xml']);
    expect(idx.duplicateIds.sort()).toEqual(['d1/package.xml', 'd2/package.xml']);
    expect(idx.byName.absent_dep).toBeUndefined();
    expect(idx.byName.g1).toBeUndefined();
    expect(idx.groupMembers.g1).toEqual(['nested/package.xml']);
    const toDup = idx.reverse['d1/package.xml'];
    expect(toDup).toHaveLength(1);
    expect(toDup[0]).toMatchObject({ sourceId: 'package.xml', ambiguous: true });
    expect(idx.reverse['nested/package.xml'][0]).toMatchObject({ sourceId: 'package.xml', ambiguous: false });
    expect(idx.unindexedCount).toBe(3);
  });

  it('filters case-insensitively on name, description and path with a stable sort', async () => {
    const { packages } = await scan(tmp);
    const entries = toSearchEntries(packages);
    const q = { text: '', sort: 'name' as const, status: 'all' as const, duplicatesOnly: false };
    expect(filterPackages(entries, { ...q, text: 'DUP' }, new Set()).map((p) => p.id)).toEqual(['d1/package.xml', 'd2/package.xml']);
    expect(filterPackages(entries, { ...q, text: 'd nested' }, new Set()).map((p) => p.id)).toEqual(['nested/package.xml']);
    expect(filterPackages(entries, { ...q, text: '.hidden' }, new Set()).map((p) => p.id)).toEqual(['.hidden/h/package.xml']);
    expect(filterPackages(entries, { ...q, duplicatesOnly: true }, new Set(['d2/package.xml'])).map((p) => p.id)).toEqual(['d2/package.xml']);
  });
});

describe('path guard', () => {
  it('rejects traversal, absolute paths and symlink escapes', async () => {
    await expect(resolveWithin(tmp, '../etc/passwd')).rejects.toBeInstanceOf(PathDenied);
    await expect(resolveWithin(tmp, 'a/../../x')).rejects.toBeInstanceOf(PathDenied);
    await expect(resolveWithin(tmp, '/etc/passwd')).rejects.toBeInstanceOf(PathDenied);
    await expect(resolveWithin(tmp, 'escape/passwd')).rejects.toBeInstanceOf(PathDenied);
    await expect(resolveWithin(tmp, 'loop')).rejects.toBeInstanceOf(PathDenied);
    await expect(resolveWithin(tmp, 'a\0b')).rejects.toBeInstanceOf(PathDenied);
    expect(await resolveWithin(tmp, 'nested/package.xml')).toBe(path.join(tmp, 'nested/package.xml'));
  });
});

describe('file listing and preview', () => {
  it('lists lazily, directories first, and marks symlinks without following them', async () => {
    const r = await listDirectory(tmp, '');
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') return;
    expect(r.entries[0].kind).toBe('dir');
    expect(r.entries.find((e) => e.name === 'escape')?.kind).toBe('symlink');
    expect((await listDirectory(tmp, 'escape')).state).toBe('denied');
    expect((await listDirectory(tmp, 'nope')).state).toBe('missing');
  });

  it('previews text, flags binary, oversized, missing, symlinked and changed files', async () => {
    w('p/a.txt', 'hello');
    w('p/bin.dat', Buffer.from([1, 2, 0, 3]));
    w('p/huge.txt', 'x'.repeat(1024 * 1024 + 1));
    w('p/exact.txt', 'y'.repeat(1024 * 1024));
    fs.symlinkSync(path.join(tmp, 'p/a.txt'), path.join(tmp, 'p/link.txt'));
    const base = path.join(tmp, 'p');
    expect(await readPreview(base, 'a.txt')).toMatchObject({ state: 'text', text: 'hello', changed: false });
    expect((await readPreview(base, 'bin.dat')).state).toBe('binary');
    expect((await readPreview(base, 'huge.txt')).state).toBe('too-large');
    expect((await readPreview(base, 'exact.txt')).state).toBe('text');
    expect((await readPreview(base, 'gone.txt')).state).toBe('missing');
    expect((await readPreview(base, 'link.txt')).state).toBe('denied');
    expect((await readPreview(base, '../package.xml')).state).toBe('denied');
    expect((await readPreview(base, '.')).state).toBe('not-file');
    expect(await readPreview(base, 'a.txt', { size: 1, mtimeMs: 1 })).toMatchObject({ state: 'text', changed: true });
  });

  it('enforces the read limit even when the limit is lower than the file', async () => {
    w('p/grow.txt', 'z'.repeat(100));
    expect((await readPreview(path.join(tmp, 'p'), 'grow.txt', undefined, 50)).state).toBe('too-large');
  });

  it.skipIf(process.getuid?.() === 0)('reports unreadable files', async () => {
    w('p/secret.txt', 'x');
    fs.chmodSync(path.join(tmp, 'p/secret.txt'), 0o000);
    expect((await readPreview(path.join(tmp, 'p'), 'secret.txt')).state).toBe('unreadable');
  });
});
