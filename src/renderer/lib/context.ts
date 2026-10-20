import { createContext, useContext } from 'react';
import type { AppState, TabId } from './store';
import type { PackageRecord } from '../../shared/types';

export interface AppActions {
  select(id: string, mode: 'list' | 'link'): void;
  back(): void;
  forward(): void;
  setTab(tab: TabId): void;
}

export interface AppContextValue extends AppActions {
  state: AppState;
  byId: ReadonlyMap<string, PackageRecord>;
  duplicates: ReadonlySet<string>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext missing');
  return v;
}
