import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';
import { shouldUseShardedStrategy } from '@workspace/backend/src/domain/workspace-file-tree/index.js';

/** Match services/backend/convex/workspaceFiles.ts */
// fallow-ignore-next-line unused-export
export const MAX_TREE_JSON_BYTES = 900 * 1024;
// fallow-ignore-next-line unused-export
export const MAX_SHARD_JSON_BYTES = 800 * 1024;
export const MAX_SHARD_BATCH_SIZE = 8;

export type FileTreeShardPayload = {
  entries: FileTreeEntry[];
  scannedAt: number;
  rootDir: string;
};

export type PreparedFileTreeShard = {
  shardId: string;
  payload: FileTreeShardPayload;
  dataHash: string;
  entryCount: number;
  data: { compression: 'gzip'; content: string };
};

// fallow-ignore-next-line unused-export
export function computeShardDataHash(payload: FileTreeShardPayload): string {
  return createHash('md5').update(JSON.stringify(payload)).digest('hex');
}

// fallow-ignore-next-line unused-export
export function shardIdForPath(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '__root__' : path.slice(0, slash);
}

// fallow-ignore-next-line unused-export
export function shouldUseV3Upload(tree: FileTree): boolean {
  return shouldUseShardedStrategy(tree);
}

// fallow-ignore-next-line complexity
function childShardId(path: string, parentShardId: string): string {
  if (parentShardId === '__root__') {
    return shardIdForPath(path);
  }
  if (path === parentShardId) {
    return parentShardId;
  }
  const prefix = `${parentShardId}/`;
  if (!path.startsWith(prefix)) {
    return parentShardId;
  }
  const remainder = path.slice(prefix.length);
  const slash = remainder.indexOf('/');
  return slash === -1 ? parentShardId : `${parentShardId}/${remainder.slice(0, slash)}`;
}

function groupEntriesByShardId(
  entries: FileTreeEntry[],
  parentShardId: string
): Map<string, FileTreeEntry[]> {
  const groups = new Map<string, FileTreeEntry[]>();
  for (const entry of entries) {
    const shardId =
      parentShardId === '__root__'
        ? shardIdForPath(entry.path)
        : childShardId(entry.path, parentShardId);
    const group = groups.get(shardId) ?? [];
    group.push(entry);
    groups.set(shardId, group);
  }
  return groups;
}

/** Skip compressing parent shards that are too large to plausibly fit before subdividing. */
const LARGE_SHARD_ENTRY_THRESHOLD = 50_000;

function buildPreparedShard(shardId: string, payload: FileTreeShardPayload): PreparedFileTreeShard {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
  return {
    shardId,
    payload,
    dataHash: computeShardDataHash(payload),
    entryCount: payload.entries.length,
    data: { compression: 'gzip', content: compressed },
  };
}

function subdivideShardGroup(
  subgroups: Map<string, FileTreeEntry[]>,
  tree: FileTree
): PreparedFileTreeShard[] {
  const shards: PreparedFileTreeShard[] = [];
  for (const [subId, subEntries] of subgroups) {
    shards.push(...prepareShardGroup(subEntries, subId, tree));
  }
  return shards;
}

function shouldSkipParentCompression(
  subgroups: Map<string, FileTreeEntry[]>,
  entryCount: number
): boolean {
  return subgroups.size > 1 && entryCount > LARGE_SHARD_ENTRY_THRESHOLD;
}

function prepareShardGroup(
  entries: FileTreeEntry[],
  shardId: string,
  tree: FileTree
): PreparedFileTreeShard[] {
  const subgroups = groupEntriesByShardId(entries, shardId);
  if (shouldSkipParentCompression(subgroups, entries.length)) {
    return subdivideShardGroup(subgroups, tree);
  }

  const payload: FileTreeShardPayload = {
    entries,
    scannedAt: tree.scannedAt,
    rootDir: tree.rootDir,
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
  if (Buffer.byteLength(compressed, 'utf8') <= MAX_SHARD_JSON_BYTES || subgroups.size <= 1) {
    return [buildPreparedShard(shardId, payload)];
  }

  return subdivideShardGroup(subgroups, tree);
}

export function partitionFileTree(tree: FileTree): PreparedFileTreeShard[] {
  const topGroups = groupEntriesByShardId(tree.entries, '__root__');
  const shards: PreparedFileTreeShard[] = [];
  for (const [shardId, entries] of topGroups) {
    shards.push(...prepareShardGroup(entries, shardId, tree));
  }
  return shards;
}
