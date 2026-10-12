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
  GIT_POLL_TIMEOUT_MS,
  readGitStatusV2,
  type GitBranchHeader,
  type GitHeadState,
  type GitPorcelainEntry,
} from '../../../../infrastructure/services/workspace/git-workspace-porcelain.js';
import { runGit } from '../../../infrastructure/git/run-command.js';
import { LOCAL_KINDS, type LocalKind } from '../domain/workspace-state-unit.js';

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
 * The root node's HEAD and status derived from one probe snapshot, equal to `readGitHead` plus
 * `readGitPorcelainStatus` run with `rootPathspec`. Returns `undefined` when that equality cannot
 * be proven. The caller must then read the root directly for this tick.
 *
 * Each rule returns `undefined` when it fails:
 * 1. Glob metacharacters or pathspec magic in `rootPathspec`. v1 passes the pathspec to git as
 *    written. Git reads glob syntax and magic such as `:(top)` or `:!x` in it, and this projection
 *    matches neither, so the two would diverge.
 * 2. Any rename or copy in the full snapshot, including one entirely outside the pathspec. The
 *    full view can pair an inside entry with an outside candidate, and the pathspec view then
 *    pairs differently. The projection has no blob similarity to reproduce that.
 * 3. The rename limit. git skips inexact rename detection when `adds × deletes > limit²`, where
 *    `limit` is `renameLimit` (see `renameLimitFromConfig`). Then the full view shows no rename
 *    while the pathspec view may show one. Counting every add-like and delete-like entry gives
 *    upper bounds on git's counts, so this rule never misses a skip.
 *
 * Why the remaining projection is exact: if the full view has no rename and did not skip rename
 * detection, no add-delete pair reaches git's similarity threshold in the full view. Similarity
 * of a pair does not depend on the other entries, so no pair reaches it in any subset. The
 * pathspec view therefore has no renames either, and it is the pathspec filter of the full
 * entries. The filter keeps entries inside the pathspec and sorts them in git's status order.
 * An empty pathspec returns the probe entries unchanged, because they are already in that order.
 *
 * `renameLimit` must come from `readGitRenameLimit` for the same `workTree` as the snapshot.
 */
// Reason: S6 wires this into the file-tree root seam (readRootSnapshot); no production caller until then.
// fallow-ignore-next-line unused-export
export function toRootChangeSourceSnapshot(
  s: ProbeSnapshot,
  rootPathspec: string[],
  renameLimit: number
): { head: GitHeadState; entries: GitPorcelainEntry[] } | undefined {
  if (!isProvablyExact(s.entries, rootPathspec, renameLimit)) return undefined;

  const prefixes = rootPathspec.map((p) => p.replace(/\/+$/, ''));
  const matches = (p: string): boolean =>
    prefixes.some((prefix) => prefix === '' || p === prefix || p.startsWith(`${prefix}/`));

  const entries =
    prefixes.length === 0
      ? s.entries
      : s.entries.filter((entry) => matches(entry.path)).sort(gitStatusOrder);

  return { head: { head: s.branch.oid }, entries };
}

/** git's default inexact rename limit, used when neither status nor diff sets one. */
const GIT_DEFAULT_RENAME_LIMIT = 1000;

/** Characters git reads as glob syntax in a pathspec. */
const GLOB_METACHARACTERS = /[*?[\]\\]/;

/** The three rules of `toRootChangeSourceSnapshot` that decline a projection. */
function isProvablyExact(
  entries: GitPorcelainEntry[],
  rootPathspec: string[],
  renameLimit: number
): boolean {
  return (
    !rootPathspec.some((p) => GLOB_METACHARACTERS.test(p)) &&
    // Git pathspec magic (`:(top)`, `:!x`, `:/`, `:^x`, `:(glob)`) always starts with `:`.
    !rootPathspec.some((p) => p.startsWith(':')) &&
    !entries.some((entry) => /[RC]/.test(entry.xy)) &&
    !exceedsRenameLimit(entries, renameLimit)
  );
}

/**
 * True when git's inexact rename detection would be skipped for these entries. Add-like entries
 * are `A` or untracked `?`, delete-like entries are `D`. Both counts are upper bounds on git's
 * own counts, so a `true` here is conservative.
 */
function exceedsRenameLimit(entries: GitPorcelainEntry[], renameLimit: number): boolean {
  const adds = entries.filter((e) => /[A?]/.test(e.xy)).length;
  const deletes = entries.filter((e) => e.xy.includes('D')).length;
  return adds * deletes > renameLimit * renameLimit;
}

/**
 * The effective rename limit for `git status`, from the output of
 * `git config --get-regexp '^(status|diff)\.renamelimit$'`.
 *
 * Verified on git 2.49.0: `status.renameLimit` overrides `diff.renameLimit`; unset means 1000;
 * `0` means unlimited; a negative value behaves like 1000. This returns 1 for `0`, negative and
 * unparsable values. Those values have no documented meaning, so 1 is used. A smaller limit only
 * adds fallbacks, so 1 never misses a skip whatever git does with them.
 */
// Reason: S6 wires this into the file-tree root seam (readRootSnapshot); no production caller until then.
// fallow-ignore-next-line unused-export
export function renameLimitFromConfig(stdout: string): number {
  const configured =
    lastConfigValue(stdout, 'status.renamelimit') ?? lastConfigValue(stdout, 'diff.renamelimit');
  return configured === undefined ? GIT_DEFAULT_RENAME_LIMIT : toLowerBoundLimit(configured);
}

/** The value of the last `key` line in `git config --get-regexp` output; undefined when absent. */
function lastConfigValue(stdout: string, key: string): string | undefined {
  let value: string | undefined;
  for (const line of stdout.split('\n')) {
    if (line === key || line.startsWith(`${key} `)) value = line.slice(key.length + 1);
  }
  return value;
}

/** A positive integer is the limit. Any other value maps to 1, which never misses a skip. */
function toLowerBoundLimit(value: string): number {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : 1;
}

/**
 * The effective `git status` rename limit for `workTree`. Reads git config through the existing
 * runner, so it costs one extra git process per call. Call it once per snapshot, with the same
 * `workTree` as the snapshot.
 */
// Reason: S6 wires this into the file-tree root seam (readRootSnapshot); no production caller until then.
// fallow-ignore-next-line unused-export
export async function readGitRenameLimit(workTree: string): Promise<number> {
  const result = await runGit(
    ['config', '--get-regexp', '^(status|diff)\\.renamelimit$'],
    workTree,
    { timeout: GIT_POLL_TIMEOUT_MS, readOnly: true, successExitCodes: [0, 1] }
  );
  if ('error' in result) throw result.error;
  return renameLimitFromConfig(result.stdout);
}

/**
 * git's short-status order: tracked entries first, then untracked (`??`), each sorted by path.
 * git compares path bytes (UTF-8), which is not JavaScript's UTF-16 code-unit order for some
 * characters, so the comparison is on bytes.
 */
function gitStatusOrder(a: GitPorcelainEntry, b: GitPorcelainEntry): number {
  const untrackedRank = (e: GitPorcelainEntry): number => (e.xy === '??' ? 1 : 0);
  const rankDelta = untrackedRank(a) - untrackedRank(b);
  if (rankDelta !== 0) return rankDelta;
  return Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
}
