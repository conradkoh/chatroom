/**
 * Single git status poll per workspace monitor.
 *
 * The probe decides WHEN unit values must be recomputed. It does not produce unit values:
 * the existing readers and collectors own that. One probe is created per monitor and is keyed
 * on `workTree` and `rootPathspec` only.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { COMMAND_MANIFEST_BASENAMES } from '../../../../infrastructure/services/workspace/command-discovery.js';
import {
  readGitStatusV2,
  type GitBranchHeader,
  type GitHeadState,
  type GitPorcelainEntry,
} from '../../../../infrastructure/services/workspace/git-workspace-porcelain.js';
import { LOCAL_KINDS, type LocalKind } from '../domain/workspace-state-unit.js';

// Reason: the S3c collectors and the S4 monitor are the first production consumers.
// fallow-ignore-file unused-file

/** One git status read: branch header, entries, and edit fingerprints for the first entries. */
export type ProbeSnapshot = {
  branch: GitBranchHeader;
  entries: GitPorcelainEntry[];
  /** path -> `${mtimeMs}:${size}` | 'missing', for the first `dirtyStatCap` entries only */
  dirtyStats: Map<string, string>;
  /** true when entries.length > dirtyStatCap; stats for later entries are not taken */
  statCapped: boolean;
  /** now() when the read completed */
  readAt: number;
};

export interface WorkspaceGitProbe {
  readSnapshot(opts: { maxAgeMs: number }): Promise<ProbeSnapshot>;
  readonly workTree: string;
  readonly rootPathspec: string[];
}

/**
 * Creates a probe with a single-flight read and an age-bounded cache.
 *
 * - Concurrent callers share the in-flight read regardless of `maxAgeMs`.
 * - A cached snapshot is returned while `now() - readAt <= maxAgeMs`.
 * - A failed read clears the in-flight marker and leaves the cache untouched.
 */
export function createWorkspaceGitProbe(args: {
  workTree: string;
  rootPathspec: string[];
  dirtyStatCap: number;
  now?: () => number;
  readStatus?: typeof readGitStatusV2;
}): WorkspaceGitProbe {
  const now = args.now ?? (() => Date.now());
  const readStatus = args.readStatus ?? readGitStatusV2;
  let cached: ProbeSnapshot | null = null;
  let inFlight: Promise<ProbeSnapshot> | null = null;

  async function readFresh(): Promise<ProbeSnapshot> {
    const { branch, entries } = await readStatus(args.workTree);
    const capped = entries.slice(0, args.dirtyStatCap);
    const stats = await Promise.all(
      capped.map(
        async (entry) =>
          [entry.path, await statFingerprint(path.join(args.workTree, entry.path))] as const
      )
    );
    return {
      branch,
      entries,
      dirtyStats: new Map(stats),
      statCapped: entries.length > args.dirtyStatCap,
      readAt: now(),
    };
  }

  return {
    workTree: args.workTree,
    rootPathspec: args.rootPathspec,
    readSnapshot({ maxAgeMs }) {
      if (inFlight) return inFlight;
      if (cached && now() - cached.readAt <= maxAgeMs) return Promise.resolve(cached);
      inFlight = readFresh().then(
        (snapshot) => {
          cached = snapshot;
          inFlight = null;
          return snapshot;
        },
        (err: unknown) => {
          inFlight = null;
          throw err;
        }
      );
      return inFlight;
    },
  };
}

/** Edit fingerprint for one path. Any stat failure (including ENOENT) is 'missing'. */
async function statFingerprint(absPath: string): Promise<string> {
  try {
    const stat = await fs.stat(absPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function entryKey(entry: GitPorcelainEntry): string {
  return `${entry.xy}|${entry.path}|${entry.fromPath ?? ''}`;
}

function indexByKey(entries: GitPorcelainEntry[]): Map<string, GitPorcelainEntry> {
  return new Map(entries.map((entry) => [entryKey(entry), entry]));
}

function statChanged(prev: ProbeSnapshot, next: ProbeSnapshot, filePath: string): boolean {
  return prev.dirtyStats.get(filePath) !== next.dirtyStats.get(filePath);
}

/** Entries that appeared, disappeared, or whose edit fingerprint changed between two snapshots. */
function changedEntries(prev: ProbeSnapshot, next: ProbeSnapshot): GitPorcelainEntry[] {
  const prevByKey = indexByKey(prev.entries);
  const nextByKey = indexByKey(next.entries);
  const disappeared = [...prevByKey].filter(([key]) => !nextByKey.has(key)).map(([, e]) => e);
  const appearedOrEdited = [...nextByKey.values()].filter(
    (entry) => !prevByKey.has(entryKey(entry)) || statChanged(prev, next, entry.path)
  );
  return [...disappeared, ...appearedOrEdited];
}

function headMoved(prev: ProbeSnapshot, next: ProbeSnapshot): boolean {
  return prev.branch.oid !== next.branch.oid || prev.branch.head !== next.branch.head;
}

function upstreamMoved(prev: ProbeSnapshot, next: ProbeSnapshot): boolean {
  return (
    prev.branch.upstream !== next.branch.upstream ||
    prev.branch.ahead !== next.branch.ahead ||
    prev.branch.behind !== next.branch.behind
  );
}

function touchesCommandManifest(entry: GitPorcelainEntry): boolean {
  return COMMAND_MANIFEST_BASENAMES.has(path.posix.basename(entry.path));
}

/**
 * Decides which local kinds and whether a remote refresh must run, from two snapshots.
 * Pure: no I/O. Rules apply in order; `remoteTrigger` is set only by rules 1-3.
 *
 * 1. First observation → everything is unknown.
 * 2. HEAD moved (oid or head name; `head` covers a switch to a commit with the same oid) → everything.
 * 3. Upstream tracking changed → `upstream`, remote trigger.
 * 4. Worktree changed, including edits to files that were already modified → `worktree`,
 *    plus `commands` when a command manifest is among the changed paths.
 */
export function diffProbeSnapshots(
  prev: ProbeSnapshot | null,
  next: ProbeSnapshot
): { localKinds: Set<LocalKind>; remoteTrigger: boolean } {
  if (prev === null || headMoved(prev, next)) {
    return { localKinds: new Set(LOCAL_KINDS), remoteTrigger: true };
  }
  const remoteTrigger = upstreamMoved(prev, next);
  return { localKinds: localKindsFor(remoteTrigger, changedEntries(prev, next)), remoteTrigger };
}

/** Rule 3 and rule 4 local kinds. `upstream` is passed in because rule 3 is decided separately. */
function localKindsFor(upstreamChanged: boolean, changed: GitPorcelainEntry[]): Set<LocalKind> {
  const kinds = new Set<LocalKind>();
  if (upstreamChanged) kinds.add('upstream');
  if (changed.length > 0) kinds.add('worktree');
  if (changed.some(touchesCommandManifest)) kinds.add('commands');
  return kinds;
}

/**
 * Projects a probe snapshot onto the root change-source shape, restricted to `rootPathspec`.
 * An entry is kept when its path or its rename origin is equal to a prefix or below it.
 * An empty pathspec keeps everything.
 */
export function toRootChangeSourceSnapshot(
  s: ProbeSnapshot,
  rootPathspec: string[]
): { head: GitHeadState; entries: GitPorcelainEntry[] } {
  const prefixes = rootPathspec.map((p) => p.replace(/\/+$/, ''));
  const matches = (p: string): boolean =>
    prefixes.some((prefix) => prefix === '' || p === prefix || p.startsWith(`${prefix}/`));

  const entries =
    prefixes.length === 0
      ? s.entries
      : s.entries.filter(
          (entry) =>
            matches(entry.path) || (entry.fromPath !== undefined && matches(entry.fromPath))
        );

  return { head: { head: s.branch.oid }, entries };
}
