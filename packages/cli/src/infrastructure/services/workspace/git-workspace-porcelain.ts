import { runGit } from '../../git/run-command.js';
import type { GitRepoNode } from './git-workspace-hierarchy.js';
import type { WorkspaceFsEvent, WorkspaceFsEventKind } from './workspace-fs-watcher.js';

export interface GitPorcelainEntry {
  xy: string;
  path: string;
  fromPath?: string;
}

export type GitHeadState = {
  head: string | null;
};

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
      const dest = parts[i] ?? '';
      entries.push({
        xy,
        path: dest.replace(/\\/g, '/'),
        fromPath: rest.replace(/\\/g, '/'),
      });
    } else if (rest) {
      entries.push({ xy, path: rest.replace(/\\/g, '/') });
    }
    i++;
  }

  return entries;
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
  events: Array<{ kind: WorkspaceFsEventKind; path: string }>;
} {
  const { xy, path: entryPath } = entry;
  const events: Array<{ kind: WorkspaceFsEventKind; path: string }> = [];
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

export async function readGitHead(workTree: string): Promise<GitHeadState> {
  const result = await runGit(['rev-parse', 'HEAD'], workTree);
  if ('error' in result) return { head: null };
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
  const result = await runGit(args, node.workTree);
  if ('error' in result) return [];
  return parseGitPorcelainZ(result.stdout);
}
