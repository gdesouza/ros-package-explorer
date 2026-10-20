import { emptyIndex } from '../../core/depIndex';
import type {
  DependencyIndex,
  Diagnostic,
  PackageRecord,
  ScanEvent,
  ScanProgress,
  ScanState,
} from '../../shared/types';

export type TabId = 'overview' | 'dependencies' | 'files' | 'manifest';

export interface AppState {
  scanId: number | null;
  root: string | null;
  scan: ScanState;
  progress: ScanProgress;
  scanError?: string;
  packages: PackageRecord[];
  diagnostics: Diagnostic[];
  index: DependencyIndex;
  indexReady: boolean;
  selectedId: string | null;
  history: string[];
  historyPos: number;
  tab: TabId;
}

export type Action =
  | { type: 'scan-event'; event: ScanEvent }
  | { type: 'select'; id: string; mode: 'list' | 'link' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'tab'; tab: TabId };

const zero: ScanProgress = { directoriesVisited: 0, manifestsFound: 0, skippedLinks: 0 };

export const initialState: AppState = {
  scanId: null,
  root: null,
  scan: 'idle',
  progress: zero,
  packages: [],
  diagnostics: [],
  index: emptyIndex(),
  indexReady: false,
  selectedId: null,
  history: [],
  historyPos: -1,
  tab: 'overview',
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'scan-event': {
      const e = action.event;
      if (e.type === 'started') {
        // A new workspace or refresh: nothing from the previous scan may survive.
        return { ...initialState, scanId: e.scanId, root: e.root, scan: 'scanning', tab: state.tab };
      }
      if (e.scanId !== state.scanId) return state;
      switch (e.type) {
        case 'progress':
          return { ...state, progress: e.progress };
        case 'batch':
          return {
            ...state,
            packages: state.packages.concat(e.packages),
            diagnostics: state.diagnostics.concat(e.diagnostics),
          };
        case 'index':
          return { ...state, index: e.index, indexReady: true };
        case 'finished':
          return { ...state, scan: e.state, progress: e.progress, scanError: e.error };
      }
      return state;
    }
    case 'select': {
      if (action.id === state.selectedId) return state;
      if (action.mode === 'list') {
        return { ...state, selectedId: action.id, history: [action.id], historyPos: 0 };
      }
      const history = [...state.history.slice(0, state.historyPos + 1), action.id];
      return { ...state, selectedId: action.id, history, historyPos: history.length - 1 };
    }
    case 'back':
      return state.historyPos > 0
        ? { ...state, historyPos: state.historyPos - 1, selectedId: state.history[state.historyPos - 1] }
        : state;
    case 'forward':
      return state.historyPos < state.history.length - 1
        ? { ...state, historyPos: state.historyPos + 1, selectedId: state.history[state.historyPos + 1] }
        : state;
    case 'tab':
      return { ...state, tab: action.tab };
  }
}
