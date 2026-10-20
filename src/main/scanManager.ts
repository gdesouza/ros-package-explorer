import * as fsp from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import type { ScanEvent, ScanState, WorkspaceInfo } from '../shared/types';

interface Scan {
  scanId: number;
  root: string;
  worker: Worker;
  state: ScanState;
  packages: Map<string, { packageDir: string; manifestPath: string }>;
  closed: boolean;
}

export class StaleScanError extends Error {}

/**
 * Owns the single active workspace scan. Each scan has a unique id; events
 * from superseded scans are dropped before they can reach the renderer.
 */
export class ScanManager {
  private nextId = 1;
  private current: Scan | null = null;

  constructor(
    private readonly workerPath: string,
    private readonly emit: (event: ScanEvent) => void,
  ) {}

  get root(): string | null {
    return this.current?.root ?? null;
  }

  async start(root: string): Promise<WorkspaceInfo> {
    const canonical = await fsp.realpath(root);
    const st = await fsp.stat(canonical);
    if (!st.isDirectory()) throw new Error('The selected path is not a directory.');

    this.dispose();
    const scanId = this.nextId++;
    const worker = new Worker(this.workerPath, { workerData: { root: canonical, scanId } });
    const scan: Scan = { scanId, root: canonical, worker, state: 'scanning', packages: new Map(), closed: false };
    this.current = scan;

    worker.on('message', (event: ScanEvent) => {
      if (this.current !== scan || event.scanId !== scan.scanId) return;
      if (event.type === 'batch') {
        for (const p of event.packages) scan.packages.set(p.id, { packageDir: p.packageDir, manifestPath: p.manifestPath });
      } else if (event.type === 'finished') {
        scan.state = event.state;
        scan.closed = true;
      }
      this.emit(event);
    });
    const failed = (message: string) => {
      if (this.current !== scan || scan.closed) return;
      scan.closed = true;
      scan.state = 'failed';
      this.emit({
        type: 'finished',
        scanId,
        state: 'failed',
        progress: { directoriesVisited: 0, manifestsFound: scan.packages.size, skippedLinks: 0 },
        error: message,
      });
    };
    worker.on('error', (e: Error) => failed(e.message));
    worker.on('exit', (code) => failed(`Scan worker exited unexpectedly (code ${code}).`));

    this.emit({ type: 'started', scanId, root: canonical });
    return { scanId, root: canonical };
  }

  refresh(): Promise<WorkspaceInfo> {
    if (!this.current) return Promise.reject(new Error('No workspace is open.'));
    return this.start(this.current.root);
  }

  cancel(): void {
    if (this.current && !this.current.closed) this.current.worker.postMessage('cancel');
  }

  /** Resolves a package of the current scan, rejecting requests from older scans. */
  lookup(scanId: number, packageId: string): { packageDir: string; manifestPath: string; root: string } {
    const scan = this.current;
    if (!scan || scan.scanId !== scanId) throw new StaleScanError('The workspace changed; reopen the package.');
    const pkg = typeof packageId === 'string' ? scan.packages.get(packageId) : undefined;
    if (!pkg) throw new StaleScanError('Unknown package for this scan.');
    return { ...pkg, root: scan.root };
  }

  dispose(): void {
    const scan = this.current;
    this.current = null;
    if (scan) {
      scan.closed = true;
      void scan.worker.terminate();
    }
  }
}
