import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import { filterPackages, toSearchEntries } from '../src/core/search';
import type { PackageRecord } from '../src/shared/types';

/** ACC-14: filter 5,000 indexed packages. Run with `npm run bench` to print the measurement. */
describe('search performance (ACC-14)', () => {
  it('filters 5,000 packages within 100 ms', () => {
    const records = Array.from({ length: 5000 }, (_, i) => ({
      id: `src/group${i % 50}/pkg_${i}/package.xml`,
      label: `pkg_${i}`,
      name: `pkg_${i}`,
      description: `Navigation and perception component number ${i} for the robot`,
      relativeDir: `src/group${i % 50}/pkg_${i}`,
    })) as unknown as PackageRecord[];
    const entries = toSearchEntries(records);
    const q = { text: '', sort: 'name' as const, status: 'all' as const, duplicatesOnly: false };
    const dups = new Set<string>();
    filterPackages(entries, q, dups); // warm up the JIT

    const times: number[] = [];
    for (const text of ['pkg_4', 'PERCEPTION', 'group7/', 'zzz-no-match', '']) {
      const t0 = performance.now();
      const out = filterPackages(entries, { ...q, text }, dups);
      times.push(performance.now() - t0);
      expect(out.length).toBeGreaterThanOrEqual(0);
    }
    const worst = Math.max(...times);
    console.info(`search bench: ${os.cpus()[0].model} x${os.cpus().length}, node ${process.version}; per-query ms = ${times.map((t) => t.toFixed(2)).join(', ')}`);
    expect(worst).toBeLessThan(100);
  });
});
