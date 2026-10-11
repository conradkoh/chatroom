import { existsSync } from 'node:fs';
import path from 'node:path';

import type { GitRepoNode } from './git-workspace-hierarchy.js';
import type { WorkspaceFsEvent, WorkspaceFsEventKind } from './workspace-fs-watcher.js';
import { runGit } from '../../../daemon/infrastructure/git/run-command.js';

export const GIT_POLL_TIMEOUT_MS = 10_000;

export class GitWorkspaceCommandError extends Error {
  readonly operation: 'readGitHead' | 'readGitPorcelainStatus' | 'readGitStatusV2';
  readonly workTree: string;
  readonly relativePath: string;
  readonly cause: Error;

  constructor(args: {
    operation: 'readGitHead' | 'readGitPorcelainStatus' | 'readGitStatusV2';
    workTree: string;
    relativePath: string;
    cause: Error;
  }) {
    const label = args.relativePath || args.workTree;
    super(`${args.operation} failed for ${label}: ${args.cause.message}`);
    this.name = 'GitWorkspaceCommandError';
    this.operation = args.operation;
    this.workTree = args.workTree;
    this.relativePath = args.relativePath;
    this.cause = args.cause;
  }
}

function isEmptyRepoHeadError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('unknown revision') ||
    message.includes('bad revision') ||
    message.includes('ambiguous argument') ||
    message.includes('needed a single revision')
  );
}

export interface GitPorcelainEntry {
  xy: string;
  path: string;
  fromPath?: string | undefined;
}

export type GitHeadState = {
  head: string | null;
};

/**
 * Parses `git status --porcelain=v1 -z`.
 *
 * Rename/copy convention: `path` is the destination and `fromPath` is the origin. Git writes the
 * destination in the record (`R  <new>`) and the origin as the next NUL-terminated field
 * (`<old>`). Consumers rely on this order: a rename emits `add(path)` and `unlink(fromPath)`.
 */
export function parseGitPorcelainZ(stdout: string): GitPorcelainEntry[] {
  const entries: GitPorcelainEntry[] = [];
  const parts = stdout.split('\0');

  let i = 0;
  while (i < parts.length) {
    const token = parts[i];
    if (!token) {
      i++;
      continue;
    }

    const xy = token.slice(0, 2);
    const rest = token.slice(3);

    if ((xy[0] === 'R' || xy[0] === 'C') && rest) {
      i++;
      const origin = parts[i] ?? '';
      entries.push({
        xy,
        path: rest.replace(/\\/g, '/'),
        fromPath: origin.replace(/\\/g, '/'),
      });
    } else if (rest) {
      entries.push({ xy, path: rest.replace(/\\/g, '/') });
    }
    i++;
  }

  return entries;
}

/** Branch metadata from the `# branch.*` header records of `git status --porcelain=v2 --branch`. */
export type GitBranchHeader = {
  /** HEAD commit SHA; null on an unborn branch (`(initial)`). */
  oid: string | null;
  /** Branch name; `HEAD` when detached (`(detached)`); null when git did not report one. */
  head: string | null;
  /** Configured upstream ref name, or null when there is none. */
  upstream: string | null;
  /** Commits ahead of upstream; 0 when there is no upstream. */
  ahead: number;
  /** Commits behind upstream; 0 when there is no upstream. */
  behind: number;
};

/**
 * Number of space-separated fields before the path in each v2 record type, counting the record
 * type character itself. The path is everything after them, so it may contain spaces.
 */
const V2_FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = {
  '1': 8,
  '2': 9,
  u: 10,
};

function splitV2Record(
  record: string,
  fieldsBeforePath: number
): { fields: string[]; path: string } {
  const fields: string[] = [];
  let cursor = 0;
  for (let n = 0; n < fieldsBeforePath; n++) {
    const space = record.indexOf(' ', cursor);
    if (space === -1) return { fields, path: '' };
    fields.push(record.slice(cursor, space));
    cursor = space + 1;
  }
  return { fields, path: record.slice(cursor).replace(/\\/g, '/') };
}

/** Entry for one non-rename record, or null for ignored (`!`) and unknown record types. */
function parseV2Entry(record: string): GitPorcelainEntry | null {
  const type = record.charAt(0);
  if (type === '?') {
    const { path } = splitV2Record(record, 1);
    return path ? { xy: '??', path } : null;
  }
  const fieldsBeforePath = V2_FIELDS_BEFORE_PATH[type];
  if (fieldsBeforePath === undefined) return null;
  const { fields, path } = splitV2Record(record, fieldsBeforePath);
  return path ? { xy: (fields[1] ?? '').replace(/\./g, ' '), path } : null;
}

function applyBranchHeader(branch: GitBranchHeader, record: string): void {
  const [key = '', ...valueParts] = record.slice(2).split(' ');
  const value = valueParts.join(' ');
  switch (key) {
    case 'branch.oid':
      branch.oid = value === '(initial)' ? null : value;
      return;
    case 'branch.head':
      branch.head = value === '(detached)' ? 'HEAD' : value;
      return;
    case 'branch.upstream':
      branch.upstream = value;
      return;
    case 'branch.ab': {
      const [ahead = '', behind = ''] = value.split(' ');
      branch.ahead = Math.abs(Number.parseInt(ahead, 10)) || 0;
      branch.behind = Math.abs(Number.parseInt(behind, 10)) || 0;
      return;
    }
    default:
      return;
  }
}

/**
 * Parses `git status --porcelain=v2 --branch -z`.
 *
 * Entries match `parseGitPorcelainZ` field for field (`xy` with `.` as space, backslashes
 * normalized to `/`), so `diffPorcelainSnapshots` accepts them unchanged. Rename convention:
 * `path` is the destination (the `2` header's path) and `fromPath` is the origin, which git writes
 * as the next NUL-terminated record after the header.
 */
// Reason: the WorkspaceService probe (S3b) is the first production consumer; tests use it until then.
// fallow-ignore-next-line unused-export
export function parseGitPorcelainV2Z(stdout: string): {
  branch: GitBranchHeader;
  entries: GitPorcelainEntry[];
} {
  const branch: GitBranchHeader = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 };
  const entries: GitPorcelainEntry[] = [];
  const records = stdout.split('\0');

  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? '';
    if (record.startsWith('# ')) {
      applyBranchHeader(branch, record);
    } else if (record.startsWith('2 ')) {
      // The origin path is a separate record that follows the rename header.
      const origin = records[i + 1] ?? '';
      i++;
      const renamed = parseV2Entry(record);
      if (renamed) {
        entries.push({ xy: renamed.xy, path: renamed.path, fromPath: origin.replace(/\\/g, '/') });
      }
    } else {
      const entry = parseV2Entry(record);
      if (entry) entries.push(entry);
    }
  }

  return { branch, entries };
}

export function toWorkspaceRelativePath(args: {
  workspaceRoot: string;
  node: Pick<GitRepoNode, 'workTree' | 'relativePath' | 'pathspec'>;
  pathInWorkTree: string;
}): string | null {
  const raw = args.pathInWorkTree.replace(/\\/g, '/').replace(/\/+$/, '');

  if (args.node.pathspec.length > 0) {
    const spec = (args.node.pathspec[0] ?? '').replace(/\/+$/, '');
    if (raw === spec) return args.node.relativePath || null;
    if (!raw.startsWith(spec + '/')) return null;
    const stripped = raw.slice(spec.length + 1);
    if (args.node.relativePath) {
      return `${args.node.relativePath}/${stripped}`.replace(/\/+/g, '/');
    }
    return stripped;
  }

  if (args.node.relativePath) {
    return `${args.node.relativePath}/${raw}`.replace(/\/+/g, '/');
  }
  return raw;
}

function hasDelete(xy: string): boolean {
  return xy[0] === 'D' || xy[1] === 'D';
}

function hasAdd(xy: string): boolean {
  return xy[0] === 'A' || xy[1] === 'A';
}

function isRename(xy: string): boolean {
  return xy[0] === 'R' || xy[1] === 'R';
}

function isCopy(xy: string): boolean {
  return xy[0] === 'C' || xy[1] === 'C';
}

function kindForEntry(entry: GitPorcelainEntry): {
  events: { kind: WorkspaceFsEventKind; path: string }[];
} {
  const { xy, path: entryPath } = entry;
  const events: { kind: WorkspaceFsEventKind; path: string }[] = [];
  const isDir = entryPath.endsWith('/');

  if (xy === '??') {
    events.push({ kind: isDir ? 'addDir' : 'add', path: entryPath });
  } else if (hasDelete(xy)) {
    events.push({ kind: isDir ? 'unlinkDir' : 'unlink', path: entryPath });
  } else if (hasAdd(xy)) {
    events.push({ kind: isDir ? 'addDir' : 'add', path: entryPath });
  } else if (isRename(xy)) {
    events.push({ kind: isDir ? 'addDir' : 'add', path: entryPath });
  } else if (isCopy(xy)) {
    events.push({ kind: isDir ? 'addDir' : 'add', path: entryPath });
  } else {
    events.push({ kind: 'change', path: entryPath });
  }

  return { events };
}

export function diffPorcelainSnapshots(args: {
  workspaceRoot: string;
  node: GitRepoNode;
  prev: readonly GitPorcelainEntry[];
  next: readonly GitPorcelainEntry[];
}): WorkspaceFsEvent[] {
  const events: WorkspaceFsEvent[] = [];

  const prevMap = new Map<string, string>();
  for (const entry of args.prev) {
    const wsPath = toWorkspaceRelativePath({
      workspaceRoot: args.workspaceRoot,
      node: args.node,
      pathInWorkTree: entry.path,
    });
    if (wsPath !== null) {
      prevMap.set(wsPath, entry.xy);
    }
  }

  const handledFromPaths = new Set<string>();

  for (const entry of args.next) {
    const wsPath = toWorkspaceRelativePath({
      workspaceRoot: args.workspaceRoot,
      node: args.node,
      pathInWorkTree: entry.path,
    });
    if (wsPath === null) continue;

    const prevXy = prevMap.get(wsPath);

    if (prevXy === undefined || prevXy !== entry.xy) {
      const entryEvents = kindForEntry(entry);
      for (const e of entryEvents.events) {
        events.push({ kind: e.kind, path: wsPath });
      }
    }

    if (entry.fromPath && (entry.xy[0] === 'R' || entry.xy[1] === 'R')) {
      const fromWsPath = toWorkspaceRelativePath({
        workspaceRoot: args.workspaceRoot,
        node: args.node,
        pathInWorkTree: entry.fromPath,
      });
      if (fromWsPath !== null && !handledFromPaths.has(fromWsPath)) {
        handledFromPaths.add(fromWsPath);
        events.push({
          kind: entry.fromPath.endsWith('/') ? 'unlinkDir' : 'unlink',
          path: fromWsPath,
        });
      }
    }
  }

  events.sort((a, b) => a.path.localeCompare(b.path));
  return events;
}

export function diffPorcelainAgainstKnownPaths(args: {
  workspaceRoot: string;
  node: GitRepoNode;
  knownPaths: Readonly<Record<string, unknown>>;
  next: readonly GitPorcelainEntry[];
}): WorkspaceFsEvent[] {
  const events: WorkspaceFsEvent[] = [];
  for (const entry of args.next) {
    const wsPath = toWorkspaceRelativePath({
      workspaceRoot: args.workspaceRoot,
      node: args.node,
      pathInWorkTree: entry.path,
    });
    if (wsPath === null) continue;
    if (wsPath in args.knownPaths) continue;
    const entryEvents = kindForEntry(entry);
    for (const e of entryEvents.events) {
      events.push({ kind: e.kind, path: wsPath });
    }
  }
  events.sort((a, b) => a.path.localeCompare(b.path));
  return events;
}

export function porcelainPathsLeftSnapshot(args: {
  workspaceRoot: string;
  node: GitRepoNode;
  prev: readonly GitPorcelainEntry[];
  next: readonly GitPorcelainEntry[];
}): string[] {
  const nextWsPaths = new Set<string>();
  for (const entry of args.next) {
    const wsPath = toWorkspaceRelativePath({
      workspaceRoot: args.workspaceRoot,
      node: args.node,
      pathInWorkTree: entry.path,
    });
    if (wsPath !== null) nextWsPaths.add(wsPath);
  }

  const left: string[] = [];
  for (const entry of args.prev) {
    const wsPath = toWorkspaceRelativePath({
      workspaceRoot: args.workspaceRoot,
      node: args.node,
      pathInWorkTree: entry.path,
    });
    if (wsPath === null) continue;
    if (!nextWsPaths.has(wsPath)) left.push(wsPath);
  }
  return left.sort((a, b) => a.localeCompare(b));
}

export function porcelainUntrackedDeletedEvents(args: {
  workspaceRoot: string;
  node: GitRepoNode;
  prev: readonly GitPorcelainEntry[];
  next: readonly GitPorcelainEntry[];
  pathExists?: ((absolutePath: string) => boolean) | undefined;
}): WorkspaceFsEvent[] {
  const exists = args.pathExists ?? ((p: string) => existsSync(p));
  const left = porcelainPathsLeftSnapshot({
    workspaceRoot: args.workspaceRoot,
    node: args.node,
    prev: args.prev,
    next: args.next,
  });
  if (left.length === 0) return [];

  const prevByWsPath = new Map<string, GitPorcelainEntry>();
  for (const entry of args.prev) {
    const wsPath = toWorkspaceRelativePath({
      workspaceRoot: args.workspaceRoot,
      node: args.node,
      pathInWorkTree: entry.path,
    });
    if (wsPath !== null) prevByWsPath.set(wsPath, entry);
  }

  const events: WorkspaceFsEvent[] = [];
  for (const wsPath of left) {
    const prevEntry = prevByWsPath.get(wsPath);
    if (prevEntry?.xy !== '??') continue;
    const absPath = path.join(args.node.workTree, prevEntry.path);
    if (!exists(absPath)) {
      events.push({
        kind: prevEntry.path.endsWith('/') ? 'unlinkDir' : 'unlink',
        path: wsPath,
      });
    }
  }
  events.sort((a, b) => a.path.localeCompare(b.path));
  return events;
}

export async function readGitHead(workTree: string): Promise<GitHeadState> {
  const result = await runGit(['rev-parse', 'HEAD'], workTree, {
    timeout: GIT_POLL_TIMEOUT_MS,
    readOnly: true,
  });
  if ('error' in result) {
    if (isEmptyRepoHeadError(result.error)) return { head: null };
    throw new GitWorkspaceCommandError({
      operation: 'readGitHead',
      workTree,
      relativePath: '',
      cause: result.error,
    });
  }
  const head = result.stdout.trim();
  return { head: head.length > 0 ? head : null };
}

export function headChanged(prev: GitHeadState, next: GitHeadState): boolean {
  if (prev.head === null && next.head === null) return false;
  return prev.head !== next.head;
}

export async function readGitPorcelainStatus(node: GitRepoNode): Promise<GitPorcelainEntry[]> {
  const args = ['status', '--porcelain=v1', '-z', '-uall', '--'];
  if (node.pathspec.length > 0) args.push(...node.pathspec);
  const result = await runGit(args, node.workTree, {
    timeout: GIT_POLL_TIMEOUT_MS,
    readOnly: true,
  });
  if ('error' in result) {
    throw new GitWorkspaceCommandError({
      operation: 'readGitPorcelainStatus',
      workTree: node.workTree,
      relativePath: node.relativePath,
      cause: result.error,
    });
  }
  return parseGitPorcelainZ(result.stdout);
}

/** Reads branch metadata and entries in one `git status` call. Throws `GitWorkspaceCommandError` on failure. */
// Reason: the WorkspaceService probe (S3b) is the first production consumer; tests use it until then.
// fallow-ignore-next-line unused-export
export async function readGitStatusV2(workTree: string): Promise<{
  branch: GitBranchHeader;
  entries: GitPorcelainEntry[];
}> {
  const result = await runGit(['status', '--porcelain=v2', '--branch', '-z', '-uall'], workTree, {
    timeout: GIT_POLL_TIMEOUT_MS,
    readOnly: true,
  });
  if ('error' in result) {
    throw new GitWorkspaceCommandError({
      operation: 'readGitStatusV2',
      workTree,
      relativePath: '',
      cause: result.error,
    });
  }
  return parseGitPorcelainV2Z(result.stdout);
}
