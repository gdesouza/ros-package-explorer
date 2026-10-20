import { parentPort, workerData } from 'node:worker_threads';
import { buildDependencyIndex } from '../core/depIndex';
import { discover } from '../core/discovery';
import type { Diagnostic, PackageRecord, ScanEvent, ScanProgress } from '../shared/types';

export interface WorkerInput {
  root: string;
  scanId: number;
}

const { root, scanId } = workerData as WorkerInput;
const port = parentPort!;
const post = (e: ScanEvent) => port.postMessage(e);

let cancelled = false;
port.on('message', (m: unknown) => {
  if (m === 'cancel') cancelled = true;
});

const all: PackageRecord[] = [];
let pending: PackageRecord[] = [];
let pendingDiags: Diagnostic[] = [];
let lastFlush = Date.now();
let lastProgress: ScanProgress | undefined;

function flush(force = false) {
  const now = Date.now();
  if (!force && now - lastFlush < 100 && pending.length < 200) return;
  lastFlush = now;
  if (pending.length || pendingDiags.length) {
    post({ type: 'batch', scanId, packages: pending, diagnostics: pendingDiags });
    pending = [];
    pendingDiags = [];
  }
  if (lastProgress) post({ type: 'progress', scanId, progress: lastProgress });
}

async function run() {
  try {
    const result = await discover(root, {
      cancelled: () => cancelled,
      onPackage: (r) => {
        all.push(r);
        pending.push(r);
        pendingDiags.push(...r.diagnostics);
        flush();
      },
      onDiagnostic: (d) => {
        pendingDiags.push(d);
        flush();
      },
      onProgress: (p) => {
        lastProgress = p;
        flush();
      },
    });
    lastProgress = result.progress;
    flush(true);
    post({ type: 'index', scanId, index: buildDependencyIndex(all) });
    post({ type: 'finished', scanId, state: result.state, progress: result.progress });
  } catch (e) {
    flush(true);
    post({
      type: 'finished',
      scanId,
      state: 'failed',
      progress: lastProgress ?? { directoriesVisited: 0, manifestsFound: 0, skippedLinks: 0 },
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

void run();
