// fallow-ignore-file complexity
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';

import { computeFileTreeDataHash } from './file-tree-data-hash.js';
import { scanFileTree } from './file-tree-scanner.js';
import { GitWorkspaceCommandError } from './git-workspace-porcelain.js';
import { normalizeWorkingDirForLookup } from './normalize-working-dir.js';
import { createWorkspaceChangeSource } from './workspace-change-source.js';
import {
  createWorkspaceFsWatcher,
  isTooManyOpenFilesError,
  type WorkspaceFsEvent,
  type WorkspaceFsWatcherHandle,
} from './workspace-fs-watcher.js';
import {
  isPathIgnoredByRuleSets,
  isWorkspacePathIgnored,
  loadAllWorkspaceIgnoreRuleSets,
} from './workspace-ignore.js';
import { diffPathIndexes } from './workspace-sync-diff.js';
import {
  buildPathIndex,
  createManifestFromTree,
  entriesFromPathIndex,
  loadWorkspaceSyncManifest,
  saveWorkspaceSyncManifest,
  type WorkspacePathDeltaEntry,
  type WorkspacePathType,
  type WorkspacePendingDelta,
  type WorkspaceSyncManifest,
} from './workspace-sync-state.js';

const DEFAULT_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_CHECKPOINT_EVERY_REVISIONS = 100;
const RECONCILE_JITTER_RATIO = 0.2;
/** Keep comfortably below the backend's 500-operation / 800KB limits. */
const MAX_DELTA_OPERATIONS = 100;

export type DeltaPushResult =
  | { status: 'applied'; revision: number }
  | { status: 'duplicate'; revision: number }
  | { status: 'conflict'; revision: number };

export interface WorkspaceFileTreeCoordinatorOptions {
  machineId: string;
  workingDir: string;
  reconcileIntervalMs?: number;
  checkpointEveryRevisions?: number;
  onDelta: (delta: WorkspacePendingDelta, baseRevision: number) => Promise<DeltaPushResult>;
  onCheckpoint: (tree: FileTree, revision: number) => Promise<{ revision: number }>;
  onError?: (error: unknown) => void;
  onReconciled?: (correctedPathCount: number) => void;
}

export interface WorkspaceFileTreeCoordinator {
  readonly workingDir: string;
  getManifest: () => WorkspaceSyncManifest;
  getTree: () => FileTree;
  checkpoint: () => Promise<void>;
  reconcile: () => Promise<void>;
  stop: () => Promise<void>;
}

function deltaEntry(
  paths: Record<string, WorkspacePathType>,
  pathValue: string
): WorkspacePathDeltaEntry {
  const type = paths[pathValue];
  if (type === undefined) throw new Error(`Missing path type for delta: ${pathValue}`);
  return { path: pathValue, type };
}

// fallow-ignore-next-line unused-export
export function buildPendingDeltas(
  previous: Record<string, WorkspacePathType>,
  next: Record<string, WorkspacePathType>
): WorkspacePendingDelta[] {
  const diff = diffPathIndexes(previous, next);
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.typeChanged.length === 0) {
    return [];
  }
  const operations = [
    ...diff.added.map((entryPath) => ({
      kind: 'added' as const,
      entry: deltaEntry(next, entryPath),
    })),
    ...diff.removed.map((entryPath) => ({ kind: 'removed' as const, path: entryPath })),
    ...diff.typeChanged.map((entryPath) => ({
      kind: 'typeChanged' as const,
      entry: deltaEntry(next, entryPath),
    })),
  ];
  const result: WorkspacePendingDelta[] = [];
  for (let offset = 0; offset < operations.length; offset += MAX_DELTA_OPERATIONS) {
    const delta: WorkspacePendingDelta = {
      operationId: randomUUID(),
      added: [],
      removed: [],
      typeChanged: [],
      createdAt: Date.now(),
    };
    for (const operation of operations.slice(offset, offset + MAX_DELTA_OPERATIONS)) {
      if (operation.kind === 'added') delta.added.push(operation.entry);
      else if (operation.kind === 'removed') delta.removed.push(operation.path);
      else delta.typeChanged.push(operation.entry);
    }
    result.push(delta);
  }
  return result;
}

function isIgnoreFile(relativePath: string): boolean {
  return (
    relativePath === '.gitignore' ||
    relativePath === '.cursorignore' ||
    relativePath.endsWith('/.gitignore')
  );
}

function removePathAndDescendants(
  paths: Record<string, WorkspacePathType>,
  relativePath: string
): void {
  delete paths[relativePath];
  const prefix = `${relativePath}/`;
  for (const candidate of Object.keys(paths)) {
    if (candidate.startsWith(prefix)) delete paths[candidate];
  }
}

function ensureParentDirectories(
  paths: Record<string, WorkspacePathType>,
  relativePath: string
): void {
  const parts = relativePath.split('/');
  for (let index = 1; index < parts.length; index++) {
    paths[parts.slice(0, index).join('/')] = 'directory';
  }
}

async function addDirectorySubtree(
  rootDir: string,
  relativeDir: string,
  paths: Record<string, WorkspacePathType>
): Promise<void> {
  if (await isWorkspacePathIgnored(rootDir, relativeDir)) return;
  ensureParentDirectories(paths, relativeDir);
  paths[relativeDir] = 'directory';

  const subtree = await scanFileTree(path.join(rootDir, relativeDir));
  for (const entry of subtree.entries) {
    const prefixedPath = `${relativeDir}/${entry.path}`;
    if (await isWorkspacePathIgnored(rootDir, prefixedPath)) continue;
    paths[prefixedPath] = entry.type;
  }
}

async function applyFsEvents(
  rootDir: string,
  previous: Record<string, WorkspacePathType>,
  events: readonly WorkspaceFsEvent[]
): Promise<Record<string, WorkspacePathType> | null> {
  if (events.some((event) => isIgnoreFile(event.path))) return null;
  const next = { ...previous };

  for (const event of events) {
    if (event.kind === 'unlink' || event.kind === 'unlinkDir') {
      removePathAndDescendants(next, event.path);
      continue;
    }
    if (event.kind === 'change' && next[event.path] !== undefined) continue;
    if (await isWorkspacePathIgnored(rootDir, event.path)) {
      removePathAndDescendants(next, event.path);
      continue;
    }
    if (event.kind === 'addDir') {
      await addDirectorySubtree(rootDir, event.path, next);
    } else {
      ensureParentDirectories(next, event.path);
      next[event.path] = 'file';
    }
  }
  return next;
}

function treeFromManifest(manifest: WorkspaceSyncManifest): FileTree {
  return {
    entries: entriesFromPathIndex(manifest.paths),
    rootDir: manifest.workingDir,
    scannedAt: manifest.completedAt,
  };
}

function nextReconcileDelay(baseMs: number): number {
  const jitter = baseMs * RECONCILE_JITTER_RATIO;
  return Math.max(1_000, Math.round(baseMs - jitter + Math.random() * jitter * 2));
}

export async function startWorkspaceFileTreeCoordinator(
  options: WorkspaceFileTreeCoordinatorOptions
): Promise<WorkspaceFileTreeCoordinator> {
  const workingDir = normalizeWorkingDirForLookup(options.workingDir);
  let stopped = false;
  let serial = Promise.resolve();
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  const loadedManifest = await loadWorkspaceSyncManifest(options.machineId, workingDir);
  const isColdStart = loadedManifest === null;
  let manifest: WorkspaceSyncManifest;

  if (loadedManifest) {
    manifest = loadedManifest;
  } else {
    const tree = await scanFileTree(workingDir);
    manifest = createManifestFromTree({
      machineId: options.machineId,
      workingDir,
      scanner: 'filesystem',
      dataHash: computeFileTreeDataHash(tree),
      tree,
    });
    await saveWorkspaceSyncManifest(manifest);
  }

  const publishCheckpoint = async (): Promise<void> => {
    const result = await options.onCheckpoint(treeFromManifest(manifest), manifest.backendRevision);
    manifest.backendRevision = result.revision;
    manifest.checkpointRevision = result.revision;
    manifest.pendingDeltas = [];
    await saveWorkspaceSyncManifest(manifest);
  };

  if (isColdStart) await publishCheckpoint();

  const flushPending = async (): Promise<void> => {
    while (!stopped && manifest.pendingDeltas.length > 0) {
      const delta = manifest.pendingDeltas[0];
      if (!delta) break;
      const result = await options.onDelta(delta, manifest.backendRevision);
      if (result.status === 'conflict') {
        manifest.backendRevision = result.revision;
        await saveWorkspaceSyncManifest(manifest);
        continue;
      }
      manifest.backendRevision = result.revision;
      manifest.pendingDeltas.shift();
      await saveWorkspaceSyncManifest(manifest);
      const checkpointEvery =
        options.checkpointEveryRevisions ?? DEFAULT_CHECKPOINT_EVERY_REVISIONS;
      if (
        manifest.pendingDeltas.length === 0 &&
        manifest.backendRevision - manifest.checkpointRevision >= checkpointEvery
      ) {
        await publishCheckpoint();
      }
    }
  };

  const commitPaths = async (
    nextPaths: Record<string, WorkspacePathType>,
    reconciledAt?: number
  ): Promise<number> => {
    const deltas = buildPendingDeltas(manifest.paths, nextPaths);
    if (reconciledAt !== undefined) manifest.lastReconciledAt = reconciledAt;
    if (deltas.length === 0) {
      if (reconciledAt !== undefined) await saveWorkspaceSyncManifest(manifest);
      await flushPending();
      return 0;
    }
    manifest.paths = nextPaths;
    manifest.totalEntryCount = Object.keys(nextPaths).length;
    manifest.completedAt = Date.now();
    manifest.localRevision += 1;
    manifest.pendingDeltas.push(...deltas);
    manifest.dataHash = computeFileTreeDataHash(treeFromManifest(manifest));
    await saveWorkspaceSyncManifest(manifest);
    await flushPending();
    return deltas.reduce(
      (total, delta) =>
        total + delta.added.length + delta.removed.length + delta.typeChanged.length,
      0
    );
  };

  const reconcileNow = async (): Promise<void> => {
    const tree = await scanFileTree(workingDir);
    const corrected = await commitPaths(buildPathIndex(tree.entries), tree.scannedAt);
    options.onReconciled?.(corrected);
  };

  const enqueueSerial = (task: () => Promise<void>): Promise<void> => {
    serial = serial.then(task, task).catch((error: unknown) => {
      options.onError?.(error);
    });
    return serial;
  };

  const scheduleReconcile = (delay?: number): void => {
    if (stopped) return;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    const interval = options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    reconcileTimer = setTimeout(
      () => {
        reconcileTimer = null;
        void enqueueSerial(reconcileNow).finally(() => scheduleReconcile());
      },
      delay ?? nextReconcileDelay(interval)
    );
    reconcileTimer.unref?.();
  };

  await flushPending();
  const ignoreRuleSets = await loadAllWorkspaceIgnoreRuleSets(workingDir);
  const shouldIgnorePath = (relativePath: string): boolean =>
    isPathIgnoredByRuleSets(ignoreRuleSets, relativePath);
  let changeSource: WorkspaceFsWatcherHandle | null = null;
  let changeSourceMode: 'git' | 'fs' = 'fs';
  let gitDegraded = false;

  const handleChangeSourceEvents = async (events: readonly WorkspaceFsEvent[]): Promise<void> => {
    await enqueueSerial(async () => {
      const nextPaths = await applyFsEvents(workingDir, manifest.paths, events);
      if (nextPaths === null) {
        await reconcileNow();
        return;
      }
      await commitPaths(nextPaths);
    });
  };

  const handleChangeSourceError = (error: unknown): void => {
    if (error instanceof GitWorkspaceCommandError) {
      console.warn(
        `[workspace-file-tree] git poll error (${error.operation}) workTree=${error.workTree} relativePath=${error.relativePath || '.'}: ${error.cause.message}`
      );
    }
    options.onError?.(error);
    if (changeSourceMode === 'fs' && isTooManyOpenFilesError(error) && changeSource) {
      const active = changeSource;
      changeSource = null;
      void active.stop().finally(() => scheduleReconcile(1_000));
      return;
    }
    scheduleReconcile(1_000);
  };

  const degradeGitToFs = async (reason: string): Promise<void> => {
    if (gitDegraded || changeSourceMode !== 'git' || !changeSource) return;
    gitDegraded = true;
    console.log(`[workspace-file-tree] degrading to fs watcher: ${reason}`);
    const active = changeSource;
    changeSource = null;
    changeSourceMode = 'fs';
    await active.stop();
    const fs = createWorkspaceFsWatcher({
      workingDir,
      shouldIgnore: shouldIgnorePath,
      onEvents: handleChangeSourceEvents,
      onError: handleChangeSourceError,
    });
    changeSource = fs;
    await fs.ready;
    console.log('[workspace-file-tree] change source: fs (degraded from git)');
  };

  const change = await createWorkspaceChangeSource({
    workingDir,
    shouldIgnore: shouldIgnorePath,
    onEvents: handleChangeSourceEvents,
    onNeedsReconcile: () => enqueueSerial(reconcileNow),
    onError: handleChangeSourceError,
    onPersistentFailure: () => degradeGitToFs('persistent git poll failures'),
  });
  changeSource = change.source;
  changeSourceMode = change.mode;
  if (change.mode === 'git') {
    console.log(
      `[workspace-file-tree] change source: git (${change.gitRepoCount ?? 1} repo${(change.gitRepoCount ?? 1) === 1 ? '' : 's'})`
    );
  } else {
    console.log('[workspace-file-tree] change source: fs');
  }
  await changeSource.ready;
  scheduleReconcile();

  return {
    workingDir,
    getManifest: () => manifest,
    getTree: () => treeFromManifest(manifest),
    checkpoint: () => enqueueSerial(publishCheckpoint),
    reconcile: () => enqueueSerial(reconcileNow),
    stop: async () => {
      stopped = true;
      if (reconcileTimer) clearTimeout(reconcileTimer);
      reconcileTimer = null;
      await changeSource?.stop();
      changeSource = null;
      await serial;
      await saveWorkspaceSyncManifest(manifest);
    },
  };
}
