/**
 * Local workspace-state unit collector.
 *
 * Reads git and the filesystem for one working directory and returns the requested local units.
 * Pure over the existing readers: no state, no timers, no decision about whether to send a unit.
 * The monitor owns scheduling, hashing, and dedup.
 */
import {
  discoverCommands,
  type DiscoveredCommand,
} from '../../../../infrastructure/services/workspace/command-discovery.js';
import {
  getBranch,
  getCommitsAhead,
  getCommitsBehind,
  getDiffStat,
  getRecentCommits,
  getRemotes,
  isDirty,
  isGitRepo,
  type GitRemoteEntry,
} from '../../../infrastructure/git/git-reader.js';
import {
  COMMITS_PER_PAGE,
  type GitBranchResult,
  type GitCommit,
} from '../../../infrastructure/git/types.js';
import type { WorkspaceStateUnit } from '../../../infrastructure/outbox/workspace-state-outbox-schema.js';
import type { LocalKind } from '../domain/workspace-state-unit.js';

// Reason: S4 (workspace monitor, service/**) is the first production consumer; it is not wired yet.
// fallow-ignore-file unused-file

type UnitOf<K extends WorkspaceStateUnit['kind']> = Extract<WorkspaceStateUnit, { kind: K }>;
type CommitEntry = UnitOf<'recentCommits'>['commits'][number];
type CommandEntry = UnitOf<'commands'>['commands'][number];

export type LocalCollectResult = {
  units: WorkspaceStateUnit[];
  /** true when `branch` is a real branch name (repo exists and HEAD is readable) */
  headAvailable: boolean;
  /** null when head is not available */
  branch: string | null;
  /** true when the repo has at least one remote; only meaningful when headAvailable */
  hasRemote: boolean;
};

/**
 * Collects the local units named in `kinds` for `workingDir`.
 *
 * Constraints:
 * - `head` is always emitted; it is the base of every unit set and is never gated by `kinds`.
 * - `remotes` is always read when head is available, so `hasRemote` is known even when
 *   `'remotes'` is not requested. The monitor needs it to decide whether to poll remotes at all.
 * - When head is unavailable, only `head` and `commands` are emitted. `commands` does not depend
 *   on git, so it is still collected for a non-repo working directory.
 *
 * Reader failures surface as the head `error` variant or as zero values, matching the existing
 * git-state pipeline. This function does not throw on git failures.
 */
export async function collectLocalUnits(
  workingDir: string,
  kinds: ReadonlySet<LocalKind>
): Promise<LocalCollectResult> {
  const [head, commandUnits] = await Promise.all([
    readHead(workingDir),
    whenRequested(kinds, 'commands', () => readCommandsUnits(workingDir)),
  ]);
  const { branch } = head;

  if (branch === null) {
    return {
      units: [...head.units, ...commandUnits],
      headAvailable: false,
      branch: null,
      hasRemote: false,
    };
  }

  const [worktreeUnits, upstreamUnits, remotes, recentCommitsUnits] = await Promise.all([
    whenRequested(kinds, 'worktree', () => readWorktreeUnits(workingDir)),
    whenRequested(kinds, 'upstream', () => readUpstreamUnits(workingDir)),
    getRemotes(workingDir),
    whenRequested(kinds, 'recentCommits', () => readRecentCommitsUnits(workingDir)),
  ]);

  return {
    units: [
      ...head.units,
      ...worktreeUnits,
      ...upstreamUnits,
      ...remotesUnits(kinds, remotes),
      ...recentCommitsUnits,
      ...commandUnits,
    ],
    headAvailable: true,
    branch,
    hasRemote: remotes.length > 0,
  };
}

/** Runs `read` only when `kind` was requested. Keeps the kinds check out of the orchestration. */
function whenRequested(
  kinds: ReadonlySet<LocalKind>,
  kind: LocalKind,
  read: () => Promise<WorkspaceStateUnit[]>
): Promise<WorkspaceStateUnit[]> {
  return kinds.has(kind) ? read() : Promise.resolve([]);
}

/** Remotes are always read for `hasRemote`; the unit itself is emitted only when requested. */
function remotesUnits(
  kinds: ReadonlySet<LocalKind>,
  remotes: GitRemoteEntry[]
): WorkspaceStateUnit[] {
  if (!kinds.has('remotes')) return [];
  return [{ kind: 'remotes', remotes: remotes.map(toRemoteEntry) }];
}

type HeadRead = {
  units: WorkspaceStateUnit[];
  /** Branch name when HEAD is readable, otherwise null. */
  branch: string | null;
};

/**
 * Reads HEAD once and returns its unit plus the branch name.
 *
 * - not a repo → `not_found` unit
 * - `getBranch` `not_found` → no unit (the unit set omits head entirely)
 * - `getBranch` `error` → `error` unit carrying the message
 */
async function readHead(workingDir: string): Promise<HeadRead> {
  if (!(await isGitRepo(workingDir))) {
    return { units: [{ kind: 'head', status: 'not_found' }], branch: null };
  }
  return headFromBranchResult(await getBranch(workingDir));
}

function headFromBranchResult(result: GitBranchResult): HeadRead {
  switch (result.status) {
    case 'available':
      return {
        units: [{ kind: 'head', status: 'available', branch: result.branch }],
        branch: result.branch,
      };
    case 'error':
      return {
        units: [{ kind: 'head', status: 'error', errorMessage: result.message }],
        branch: null,
      };
    case 'not_found':
      return { units: [], branch: null };
  }
}

async function readCommandsUnits(workingDir: string): Promise<WorkspaceStateUnit[]> {
  const commands = await discoverCommands(workingDir);
  return [{ kind: 'commands', commands: commands.map(toCommandEntry) }];
}

async function readWorktreeUnits(workingDir: string): Promise<WorkspaceStateUnit[]> {
  const [dirty, stat] = await Promise.all([isDirty(workingDir), getDiffStat(workingDir)]);
  return [
    {
      kind: 'worktree',
      isDirty: dirty,
      diffStat:
        stat.status === 'available'
          ? { ...stat.diffStat }
          : { filesChanged: 0, insertions: 0, deletions: 0 },
    },
  ];
}

async function readUpstreamUnits(workingDir: string): Promise<WorkspaceStateUnit[]> {
  const [ahead, behind] = await Promise.all([
    getCommitsAhead(workingDir),
    getCommitsBehind(workingDir),
  ]);
  return [{ kind: 'upstream', commitsAhead: ahead, commitsBehind: behind }];
}

async function readRecentCommitsUnits(workingDir: string): Promise<WorkspaceStateUnit[]> {
  const commits = await getRecentCommits(workingDir, COMMITS_PER_PAGE);
  return [
    {
      kind: 'recentCommits',
      commits: commits.map(toCommitEntry),
      hasMoreCommits: commits.length >= COMMITS_PER_PAGE,
    },
  ];
}

function toRemoteEntry(remote: GitRemoteEntry): UnitOf<'remotes'>['remotes'][number] {
  return { name: remote.name, url: remote.url };
}

/** Copies the wire fields only. `body` is omitted rather than set to `undefined` (exactOptional). */
function toCommitEntry(commit: GitCommit): CommitEntry {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    message: commit.message,
    ...(commit.body !== undefined ? { body: commit.body } : {}),
    author: commit.author,
    date: commit.date,
  };
}

function toCommandEntry(command: DiscoveredCommand): CommandEntry {
  return {
    name: command.name,
    script: command.script,
    source: command.source,
    subWorkspace: {
      type: command.subWorkspace.type,
      path: command.subWorkspace.path,
      name: command.subWorkspace.name,
    },
  };
}
