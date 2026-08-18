import { FILE_TREE_SYNC_DEBOUNCE_MS } from './workspace-sync-config.js';

type QueueKey = string;

function queueKey(machineId: string, workingDir: string): QueueKey {
  return `${machineId}\0${workingDir}`;
}

interface WorkspaceQueueState {
  drainPromise: Promise<void> | null;
  pendingTask: (() => Promise<void>) | null;
  scheduled: boolean;
}

const queues = new Map<QueueKey, WorkspaceQueueState>();
const lastCompletedAtByKey = new Map<QueueKey, number>();

function getOrCreateState(key: QueueKey): WorkspaceQueueState {
  let state = queues.get(key);
  if (!state) {
    state = { drainPromise: null, pendingTask: null, scheduled: false };
    queues.set(key, state);
  }
  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fallow-ignore-next-line complexity
async function drainQueue(
  state: WorkspaceQueueState,
  key: QueueKey,
  debounceMs: number
): Promise<void> {
  try {
    while (state.pendingTask) {
      const lastCompletedAt = lastCompletedAtByKey.get(key) ?? 0;
      const elapsed = Date.now() - lastCompletedAt;
      const waitMs = lastCompletedAt === 0 ? 0 : Math.max(0, debounceMs - elapsed);
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const task = state.pendingTask;
      if (!task) break;
      state.pendingTask = null;
      await task();
      lastCompletedAtByKey.set(key, Date.now());
    }
  } finally {
    state.drainPromise = null;
    state.scheduled = false;
    if (state.pendingTask) {
      void kickDrain(state, key, debounceMs);
    } else {
      queues.delete(key);
    }
  }
}

function kickDrain(state: WorkspaceQueueState, key: QueueKey, debounceMs: number): void {
  if (state.scheduled || state.drainPromise) return;
  state.scheduled = true;
  state.drainPromise = new Promise<void>((resolve, reject) => {
    queueMicrotask(() => {
      void drainQueue(state, key, debounceMs).then(resolve, reject);
    });
  });
}

export type EnqueueFileTreeSyncOptions = {
  debounceMs?: number;
};

/**
 * Enqueue a file-tree sync task for a workspace.
 * Only one task runs at a time per (machineId, workingDir).
 * Concurrent enqueue calls coalesce into a single trailing rerun.
 * A minimum debounce interval separates consecutive runs.
 */
export async function enqueueFileTreeSync(
  machineId: string,
  workingDir: string,
  task: () => Promise<void>,
  options?: EnqueueFileTreeSyncOptions
): Promise<void> {
  const debounceMs = options?.debounceMs ?? FILE_TREE_SYNC_DEBOUNCE_MS;
  const key = queueKey(machineId, workingDir);
  const state = getOrCreateState(key);

  state.pendingTask = task;
  kickDrain(state, key, debounceMs);
  return state.drainPromise ?? Promise.resolve();
}

/** For tests only */
// fallow-ignore-next-line unused-export
export function resetFileTreeSyncQueuesForTests(): void {
  queues.clear();
  lastCompletedAtByKey.clear();
}
