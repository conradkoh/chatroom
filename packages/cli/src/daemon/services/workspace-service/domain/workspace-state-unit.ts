// Reason: the WorkspaceService domain is consumed by the S3b probe/collectors and S4 sync loop, which are not wired yet.
// fallow-ignore-file unused-file
import { createHash } from 'node:crypto';

import type { WorkspaceStateUnit } from '../../../infrastructure/outbox/workspace-state-outbox-schema.js';

export type { WorkspaceStateKind } from '../../../infrastructure/outbox/workspace-state-outbox.js';
export type { WorkspaceStateUnit } from '../../../infrastructure/outbox/workspace-state-outbox-schema.js';

/** Kinds read from local git and the filesystem. */
export const LOCAL_KINDS = [
  'head',
  'worktree',
  'upstream',
  'remotes',
  'recentCommits',
  'commands',
] as const;
export type LocalKind = (typeof LOCAL_KINDS)[number];

/** Kinds read from the GitHub API. */
export const REMOTE_KINDS = ['pullRequests', 'checks'] as const;
export type RemoteKind = (typeof REMOTE_KINDS)[number];

type UnitOfKind<K extends WorkspaceStateUnit['kind']> = Extract<WorkspaceStateUnit, { kind: K }>;

/** Total order on strings that does not depend on the locale. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Lexicographic combination: the first non-zero comparison wins. */
function compareAll(...results: number[]): number {
  return results.find((result) => result !== 0) ?? 0;
}

type CheckRun = NonNullable<UnitOfKind<'checks'>['headCommitStatus']>['checkRuns'][number];

function compareCheckRuns(a: CheckRun, b: CheckRun): number {
  return compareAll(compareStrings(a.name, b.name), compareStrings(a.status, b.status));
}

function normalizeChecks(u: UnitOfKind<'checks'>): UnitOfKind<'checks'> {
  const status = u.headCommitStatus;
  if (status === null) return { ...u };
  return {
    ...u,
    headCommitStatus: {
      ...status,
      checkRuns: [...status.checkRuns].sort(compareCheckRuns),
    },
  };
}

function compareRemotes(
  a: UnitOfKind<'remotes'>['remotes'][number],
  b: UnitOfKind<'remotes'>['remotes'][number]
): number {
  return compareAll(compareStrings(a.name, b.name), compareStrings(a.url, b.url));
}

function comparePullRequests(
  a: UnitOfKind<'pullRequests'>['openPullRequests'][number],
  b: UnitOfKind<'pullRequests'>['openPullRequests'][number]
): number {
  return a.prNumber - b.prNumber;
}

type Command = UnitOfKind<'commands'>['commands'][number];

/** Root-level commands sort as ''; sub-workspace commands sort by their package path. */
function subWorkspacePath(command: Command): string {
  return command.subWorkspace?.path ?? '';
}

function compareCommands(a: Command, b: Command): number {
  return compareAll(
    compareStrings(a.source, b.source),
    compareStrings(subWorkspacePath(a), subWorkspacePath(b)),
    compareStrings(a.name, b.name)
  );
}

/**
 * Canonical form of a unit for hashing and comparison. Array-valued fields are sorted so that
 * order-only differences from the source do not register as a change. Never mutates the input.
 */
// Reason: one switch arm per unit kind is the exhaustive dispatch; splitting it would only move the arms.
// fallow-ignore-next-line complexity
export function normalizeUnit(u: WorkspaceStateUnit): WorkspaceStateUnit {
  switch (u.kind) {
    case 'checks':
      return normalizeChecks(u);
    case 'remotes':
      return { ...u, remotes: [...u.remotes].sort(compareRemotes) };
    case 'pullRequests':
      return { ...u, openPullRequests: [...u.openPullRequests].sort(comparePullRequests) };
    case 'commands':
      return { ...u, commands: [...u.commands].sort(compareCommands) };
    default:
      return { ...u };
  }
}

/** SHA-1 hex digest of the normalized unit. Equal digests mean the unit has not changed. */
export function hashUnit(u: WorkspaceStateUnit): string {
  return createHash('sha1')
    .update(JSON.stringify(normalizeUnit(u)))
    .digest('hex');
}
