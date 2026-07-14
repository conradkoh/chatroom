import type { GitRepoNode, GitWorkspaceHierarchy } from './git-workspace-hierarchy.js';
import {
  diffPorcelainSnapshots,
  headChanged,
  porcelainPathsLeftSnapshot,
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
const MAX_BACKOFF_MS = 30_000;
const PERSISTENT_FAILURE_THRESHOLD = 3;

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
  baselineEstablished: boolean;
};

function computeBackoff(failures: number, pollIntervalMs: number): number {
  if (failures <= 0) return pollIntervalMs;
  const backoff = pollIntervalMs * 2 ** Math.min(failures - 1, 5);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

export function createGitWorkspaceChangeSource(
  options: GitWorkspaceChangeSourceOptions
): WorkspaceChangeSource {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const nodes = flattenGitRepoNodes(options.hierarchy.root);
  const state = new Map<string, NodePollState>();
  for (const node of nodes) {
    state.set(node.workTree, {
      prevEntries: [],
      prevHead: { head: null },
      baselineEstablished: false,
    });
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentPoll: Promise<void> = Promise.resolve();
  let nextPollDelayMs = pollIntervalMs;
  let consecutiveFailureTicks = 0;
  let persistentFailureReported = false;
  const nodeFailureCounts = new Map<string, number>();

  const schedule = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      currentPoll = runPoll();
      void currentPoll.finally(() => {
        if (!stopped) schedule(nextPollDelayMs);
      });
    }, delay);
    timer.unref?.();
  };

  const runPoll = async (): Promise<void> => {
    if (stopped) return;
    const allEvents: WorkspaceFsEvent[] = [];
    let needsReconcile = false;
    let tickHadFailure = false;
    let maxNodeFailures = 0;

    const results = await Promise.allSettled(
      nodes.map(async (node) => {
        const prev = state.get(node.workTree) ?? {
          prevEntries: [],
          prevHead: { head: null },
          baselineEstablished: false,
        };
        const [nextHead, nextEntries] = await Promise.all([
          readGitHead(node.workTree),
          readGitPorcelainStatus(node),
        ]);

        if (prev.prevHead.head !== null && headChanged(prev.prevHead, nextHead)) {
          needsReconcile = true;
        }

        if (prev.baselineEstablished) {
          const left = porcelainPathsLeftSnapshot({
            workspaceRoot: options.hierarchy.workspaceRoot,
            node,
            prev: prev.prevEntries,
            next: nextEntries,
          });
          if (left.length > 0) needsReconcile = true;

          const events = diffPorcelainSnapshots({
            workspaceRoot: options.hierarchy.workspaceRoot,
            node,
            prev: prev.prevEntries,
            next: nextEntries,
          });
          allEvents.push(...events);
        }

        state.set(node.workTree, {
          prevEntries: nextEntries,
          prevHead: nextHead,
          baselineEstablished: true,
        });
        nodeFailureCounts.set(node.workTree, 0);
        return node;
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const node = nodes[i];
      if (!node || result.status === 'fulfilled') continue;

      tickHadFailure = true;
      options.onError?.(result.reason);
      const prevFailures = nodeFailureCounts.get(node.workTree) ?? 0;
      const nextFailures = prevFailures + 1;
      nodeFailureCounts.set(node.workTree, nextFailures);
      maxNodeFailures = Math.max(maxNodeFailures, nextFailures);
    }

    if (tickHadFailure) {
      consecutiveFailureTicks += 1;
      nextPollDelayMs = computeBackoff(maxNodeFailures, pollIntervalMs);
      if (!persistentFailureReported && consecutiveFailureTicks >= PERSISTENT_FAILURE_THRESHOLD) {
        persistentFailureReported = true;
        await Promise.resolve(options.onPersistentFailure?.());
      }
    } else {
      consecutiveFailureTicks = 0;
      nextPollDelayMs = pollIntervalMs;
    }

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
    if (!stopped) schedule(nextPollDelayMs);
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
