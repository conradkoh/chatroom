import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';

import { normalizeWorkingDirForLookup } from './normalize-working-dir.js';

const SYNC_STATE_VERSION = '2';
const SYNC_STATE_DIR = join(homedir(), '.chatroom', 'sync-state');

export type WorkspaceScanner = 'git' | 'filesystem';
export type WorkspacePathType = 'file' | 'directory';

export interface WorkspacePathDeltaEntry {
  path: string;
  type: WorkspacePathType;
}

export interface WorkspacePendingDelta {
  operationId: string;
  added: WorkspacePathDeltaEntry[];
  removed: string[];
  typeChanged: WorkspacePathDeltaEntry[];
  createdAt: number;
}

export interface WorkspaceSyncManifest {
  version: typeof SYNC_STATE_VERSION;
  machineId: string;
  workingDir: string;
  syncGeneration: string;
  completedAt: number;
  scanner: WorkspaceScanner;
  dataHash: string;
  totalEntryCount: number;
  paths: Record<string, WorkspacePathType>;
  /** Monotonic local cache generation, including changes not yet acknowledged remotely. */
  localRevision: number;
  /** Latest revision acknowledged by the backend delta API. */
  backendRevision: number;
  /** Backend revision represented by the latest uploaded checkpoint. */
  checkpointRevision: number;
  lastReconciledAt: number;
  pendingDeltas: WorkspacePendingDelta[];
}

interface LegacyWorkspaceSyncManifest extends Omit<
  WorkspaceSyncManifest,
  'version' | 'localRevision' | 'backendRevision' | 'checkpointRevision' | 'lastReconciledAt'
> {
  version: '1';
}

// fallow-ignore-next-line unused-export
export function workspaceKeyFor(workingDir: string): string {
  const normalized = normalizeWorkingDirForLookup(workingDir);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function buildPathIndex(entries: FileTreeEntry[]): Record<string, 'file' | 'directory'> {
  const paths: Record<string, 'file' | 'directory'> = {};
  for (const entry of entries) {
    paths[entry.path] = entry.type;
  }
  return paths;
}

function manifestPath(machineId: string, workingDir: string): string {
  const key = workspaceKeyFor(workingDir);
  return join(SYNC_STATE_DIR, machineId, key, 'manifest.json');
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(join(filePath, '..'), { recursive: true, mode: 0o700 });
}

// fallow-ignore-next-line complexity
export async function loadWorkspaceSyncManifest(
  machineId: string,
  workingDir: string
): Promise<WorkspaceSyncManifest | null> {
  try {
    const content = await fs.readFile(manifestPath(machineId, workingDir), 'utf-8');
    const parsed = JSON.parse(content) as WorkspaceSyncManifest | LegacyWorkspaceSyncManifest;
    if (!parsed || typeof parsed !== 'object' || !parsed.paths) return null;
    if (parsed.version === '1') {
      return {
        ...parsed,
        version: SYNC_STATE_VERSION,
        scanner: 'filesystem',
        localRevision: 0,
        backendRevision: 0,
        checkpointRevision: 0,
        lastReconciledAt: parsed.completedAt,
        pendingDeltas: [],
      };
    }
    if (parsed.version !== SYNC_STATE_VERSION) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export async function saveWorkspaceSyncManifest(manifest: WorkspaceSyncManifest): Promise<void> {
  const filePath = manifestPath(manifest.machineId, manifest.workingDir);
  const tempPath = `${filePath}.tmp`;
  await ensureDir(filePath);
  const content = JSON.stringify(manifest, null, 2);
  await fs.writeFile(tempPath, content, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

export function createManifestFromTree(args: {
  machineId: string;
  workingDir: string;
  scanner: WorkspaceScanner;
  dataHash: string;
  tree: FileTree;
}): WorkspaceSyncManifest {
  return {
    version: SYNC_STATE_VERSION,
    machineId: args.machineId,
    workingDir: normalizeWorkingDirForLookup(args.workingDir),
    syncGeneration: randomUUID(),
    completedAt: Date.now(),
    scanner: args.scanner,
    dataHash: args.dataHash,
    totalEntryCount: args.tree.entries.length,
    paths: buildPathIndex(args.tree.entries),
    localRevision: 0,
    backendRevision: 0,
    checkpointRevision: 0,
    lastReconciledAt: args.tree.scannedAt,
    pendingDeltas: [],
  };
}

export function entriesFromPathIndex(paths: Record<string, 'file' | 'directory'>): FileTreeEntry[] {
  return Object.entries(paths)
    .map(([path, type]) => ({ path, type }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** For tests only */
// fallow-ignore-next-line unused-export
export async function clearWorkspaceSyncStateForTests(
  machineId: string,
  workingDir: string
): Promise<void> {
  try {
    await fs.rm(manifestPath(machineId, workingDir), { force: true });
  } catch {
    // ignore
  }
}
