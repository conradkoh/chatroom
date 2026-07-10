import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';

import { normalizeWorkingDirForLookup } from './normalize-working-dir.js';

const SYNC_STATE_VERSION = '1';
const SYNC_STATE_DIR = join(homedir(), '.chatroom', 'sync-state');

export type WorkspaceScanner = 'git' | 'filesystem';

export interface WorkspaceSyncManifest {
  version: typeof SYNC_STATE_VERSION;
  machineId: string;
  workingDir: string;
  syncGeneration: string;
  completedAt: number;
  scanner: WorkspaceScanner;
  dataHash: string;
  totalEntryCount: number;
  paths: Record<string, 'file' | 'directory'>;
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

export async function loadWorkspaceSyncManifest(
  machineId: string,
  workingDir: string
): Promise<WorkspaceSyncManifest | null> {
  try {
    const content = await fs.readFile(manifestPath(machineId, workingDir), 'utf-8');
    return JSON.parse(content) as WorkspaceSyncManifest;
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
  };
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
