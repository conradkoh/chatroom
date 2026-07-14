import type { GitRepoNode, GitWorkspaceHierarchy } from './git-workspace-hierarchy.js';
import {
  diffPorcelainSnapshots,
  headChanged,
  readGitHead,
  readGitPorcelainStatus,
  type GitHeadState,
  type GitPorcelainEntry,
} from './git-workspace-porcelain.js';
import type {
  WorkspaceChangeSource,
  WorkspaceChangeSourceOptions,
} from './workspace-change-source.js';
import type { WorkspaceFsEvent } from './workspace-fs-watcher.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;

export type GitWorkspaceChangeSourceOptions = WorkspaceChangeSourceOptions & {
  hierarchy: GitWorkspaceHierarchy;
  pollIntervalMs?: number;
  onNeedsReconcile?: () => void | Promise<void>;
};

function flattenGitRepoNodes(root: GitRepoNode): GitRepoNode[] {
  const out: GitRepoNode[] = [root];
  for (const child of root.children) {
    out.push(...flattenGitRepoNodes(child));
  }
  return out;
}

type NodePollState = {
  prevEntries: GitPorcelainEntry[];
  prevHead: GitHeadState;
};

export function createGitWorkspaceChangeSource(
  options: GitWorkspaceChangeSourceOptions
): WorkspaceChangeSource {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const nodes = flattenGitRepoNodes(options.hierarchy.root);
  const state = new Map<string, NodePollState>();
  for (const node of nodes) {
    state.set(node.workTree, { prevEntries: [], prevHead: { head: null } });
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentPoll: Promise<void> = Promise.resolve();

  const schedule = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      currentPoll = runPoll();
      void currentPoll.finally(() => {
        if (!stopped) schedule(pollIntervalMs);
      });
    }, delay);
    timer.unref?.();
  };

  const runPoll = async (): Promise<void> => {
    if (stopped) return;
    const allEvents: WorkspaceFsEvent[] = [];
    let needsReconcile = false;

    await Promise.all(
      nodes.map(async (node) => {
        const prev = state.get(node.workTree) ?? {
          prevEntries: [],
          prevHead: { head: null },
        };
        try {
          const [nextHead, nextEntries] = await Promise.all([
            readGitHead(node.workTree),
            readGitPorcelainStatus(node),
          ]);
          // Skip initial baseline (prev head is null) — only reconcile on real HEAD moves.
          if (prev.prevHead.head !== null && headChanged(prev.prevHead, nextHead)) {
            needsReconcile = true;
          }
          const events = diffPorcelainSnapshots({
            workspaceRoot: options.hierarchy.workspaceRoot,
            node,
            prev: prev.prevEntries,
            next: nextEntries,
          });
          allEvents.push(...events);
          state.set(node.workTree, { prevEntries: nextEntries, prevHead: nextHead });
        } catch (error) {
          options.onError?.(error);
        }
      })
    );

    if (stopped) return;

    if (needsReconcile) {
      await Promise.resolve(options.onNeedsReconcile?.());
    }

    const filtered = allEvents.filter((event) => {
      if (!event.path) return false;
      if (options.shouldIgnore?.(event.path)) return false;
      return true;
    });
    if (filtered.length === 0) return;

    const byPath = new Map<string, WorkspaceFsEvent>();
    for (const event of filtered) byPath.set(event.path, event);
    const events = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    try {
      await Promise.resolve(options.onEvents(events));
    } catch (error) {
      options.onError?.(error);
    }
  };

  let resolveReady: () => void;
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  currentPoll = runPoll();
  void currentPoll.finally(() => {
    resolveReady();
    if (!stopped) schedule(pollIntervalMs);
  });

  return {
    ready,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await currentPoll;
    },
  };
}
