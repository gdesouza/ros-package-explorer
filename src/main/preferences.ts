import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { DEFAULT_PREFS, type Preferences } from '../shared/types';

const MAX_RECENT = 10;

function sanitize(raw: unknown): Preferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Preferences>;
  const width = typeof r.sidebarWidth === 'number' && Number.isFinite(r.sidebarWidth) ? r.sidebarWidth : DEFAULT_PREFS.sidebarWidth;
  return {
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'system' ? r.theme : 'system',
    sidebarWidth: Math.min(640, Math.max(220, Math.round(width))),
    recentWorkspaces: Array.isArray(r.recentWorkspaces)
      ? r.recentWorkspaces.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)).slice(0, MAX_RECENT)
      : [],
  };
}

export class PreferenceStore {
  private prefs: Preferences = { ...DEFAULT_PREFS };
  private loaded = false;

  constructor(private readonly file: string) {}

  async get(): Promise<Preferences> {
    if (!this.loaded) {
      this.loaded = true;
      try {
        this.prefs = sanitize(JSON.parse(await fsp.readFile(this.file, 'utf8')));
      } catch (e) {
        // A missing file is the normal first run; a corrupt one falls back to defaults.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Ignoring unreadable preferences:', (e as Error).message);
      }
    }
    return this.prefs;
  }

  async update(patch: Partial<Preferences>): Promise<Preferences> {
    this.prefs = sanitize({ ...(await this.get()), ...patch });
    await this.save();
    return this.prefs;
  }

  async addRecent(p: string): Promise<Preferences> {
    const cur = await this.get();
    return this.update({ recentWorkspaces: [p, ...cur.recentWorkspaces.filter((x) => x !== p)] });
  }

  async removeRecent(p: string): Promise<Preferences> {
    const cur = await this.get();
    return this.update({ recentWorkspaces: cur.recentWorkspaces.filter((x) => x !== p) });
  }

  private async save(): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.prefs, null, 2));
    await fsp.rename(tmp, this.file);
  }
}
