import type { DependencyIndex, PackageRecord, ReverseRef } from '../shared/types';

/**
 * Builds name-based lookups from manifest declarations. This is not a build
 * graph: conditions are not evaluated and rosdep keys are not resolved.
 */
export function buildDependencyIndex(packages: PackageRecord[]): DependencyIndex {
  const byName: Record<string, string[]> = Object.create(null);
  const groupMembers: Record<string, string[]> = Object.create(null);
  let unindexedCount = 0;

  for (const p of packages) {
    if (!p.indexed || !p.name) {
      unindexedCount++;
      continue;
    }
    (byName[p.name] ??= []).push(p.id);
    for (const g of p.memberOfGroups) (groupMembers[g] ??= []).push(p.id);
  }

  const reverse: Record<string, ReverseRef[]> = Object.create(null);
  for (const p of packages) {
    if (!p.indexed) continue;
    for (const d of p.deps) {
      if (d.kind !== 'package') continue;
      const targets = byName[d.name];
      if (!targets) continue;
      const ref: ReverseRef = {
        sourceId: p.id,
        tag: d.tag,
        categories: d.categories,
        condition: d.condition,
        evaluation: d.evaluation,
        ambiguous: targets.length > 1,
      };
      for (const t of targets) (reverse[t] ??= []).push(ref);
    }
  }

  const duplicateIds = Object.values(byName)
    .filter((ids) => ids.length > 1)
    .flat();
  return { byName, reverse, groupMembers, duplicateIds, unindexedCount };
}

export const emptyIndex = (): DependencyIndex => ({
  byName: Object.create(null),
  reverse: Object.create(null),
  groupMembers: Object.create(null),
  duplicateIds: [],
  unindexedCount: 0,
});
