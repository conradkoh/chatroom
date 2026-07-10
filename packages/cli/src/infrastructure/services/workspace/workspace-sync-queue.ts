type QueueKey = string;

function queueKey(machineId: string, workingDir: string): QueueKey {
  return `${machineId}\0${workingDir}`;
}

interface WorkspaceQueueState {
  running: boolean;
  trailing: boolean;
  drainPromise: Promise<void> | null;
}

const queues = new Map<QueueKey, WorkspaceQueueState>();

function getOrCreateState(key: QueueKey): WorkspaceQueueState {
  let state = queues.get(key);
  if (!state) {
    state = { running: false, trailing: false, drainPromise: null };
    queues.set(key, state);
  }
  return state;
}

/**
 * Enqueue a file-tree sync task for a workspace.
 * Only one task runs at a time per (machineId, workingDir).
 * Concurrent enqueue calls coalesce into a single trailing rerun.
 */
export async function enqueueFileTreeSync(
  machineId: string,
  workingDir: string,
  task: () => Promise<void>
): Promise<void> {
  const key = queueKey(machineId, workingDir);
  const state = getOrCreateState(key);

  if (state.running) {
    state.trailing = true;
    return state.drainPromise ?? Promise.resolve();
  }

  const run = async (): Promise<void> => {
    state.running = true;
    try {
      do {
        state.trailing = false;
        await task();
      } while (state.trailing);
    } finally {
      state.running = false;
      state.trailing = false;
      if (!state.trailing) {
        queues.delete(key);
      }
    }
  };

  state.drainPromise = run();
  return state.drainPromise;
}

/** For tests only */
// fallow-ignore-next-line unused-export
export function resetFileTreeSyncQueuesForTests(): void {
  queues.clear();
}
