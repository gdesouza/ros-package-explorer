import type { PackageRecord } from '../shared/types';

export type SortKey = 'name' | 'path';
export type StatusFilter = 'all' | 'problems' | 'ok';

export interface ListQuery {
  text: string;
  sort: SortKey;
  status: StatusFilter;
  duplicatesOnly: boolean;
}

export interface SearchEntry {
  record: PackageRecord;
  haystack: string;
  sortName: string;
}

export function toSearchEntries(records: PackageRecord[]): SearchEntry[] {
  return records.map((record) => ({
    record,
    haystack: `${record.name ?? ''}\n${record.description ?? ''}\n${record.relativeDir}`.toLowerCase(),
    sortName: record.label.toLowerCase(),
  }));
}

const byPath = (a: SearchEntry, b: SearchEntry) =>
  a.record.relativeDir < b.record.relativeDir ? -1 : a.record.relativeDir > b.record.relativeDir ? 1 : 0;

/** Case-insensitive filter over name, description and relative path with a stable sort. */
export function filterPackages(entries: SearchEntry[], q: ListQuery, duplicates: ReadonlySet<string>): PackageRecord[] {
  const needle = q.text.trim().toLowerCase();
  const out = entries.filter((e) => {
    if (needle && !e.haystack.includes(needle)) return false;
    if (q.duplicatesOnly && !duplicates.has(e.record.id)) return false;
    if (q.status === 'ok' && e.record.status !== 'ok') return false;
    if (q.status === 'problems' && e.record.status === 'ok') return false;
    return true;
  });
  out.sort(
    q.sort === 'path'
      ? byPath
      : (a, b) => (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : byPath(a, b)),
  );
  return out.map((e) => e.record);
}
