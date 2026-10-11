import type { WorkspaceStateUnit } from './workspace-state-outbox-schema.js';
import type { WorkspaceStateSendResult } from './workspace-state-outbox.js';
import { decodeWorkspaceStateKey } from './workspace-state-outbox.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { SessionId } from '../../entry/daemon-types.js';

type WorkspaceStateSendDeps = {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
};

/**
 * Run `task` after every earlier task for the same working directory has settled.
 * A failed earlier task does not block later ones. The map entry is removed once it is the last.
 */
function runInWorkingDirChain<T>(
  chains: Map<string, Promise<unknown>>,
  workingDir: string,
  task: () => Promise<T>
): Promise<T> {
  const current = (chains.get(workingDir) ?? Promise.resolve()).then(task);
  const settled = current.then(
    () => undefined,
    () => undefined
  );
  chains.set(workingDir, settled);
  void settled.then(() => {
    if (chains.get(workingDir) === settled) chains.delete(workingDir);
  });
  return current;
}

/** The only place where workspace-state unit kinds map to Convex functions. */
async function deliverUnit(
  deps: WorkspaceStateSendDeps,
  workingDir: string,
  unit: WorkspaceStateUnit
): Promise<WorkspaceStateSendResult> {
  const base = { sessionId: deps.sessionId, machineId: deps.machineId, workingDir };
  switch (unit.kind) {
    case 'recentCommits':
      // upsertRecentCommits returns nothing, so there is no backend applied signal.
      await deps.backend.mutation(api.workspaces.upsertRecentCommits, {
        ...base,
        commits: unit.commits,
        hasMoreCommits: unit.hasMoreCommits,
      });
      return { applied: true };
    case 'commands':
      // syncCommands returns nothing; its no-op guard is internal to the backend.
      await deps.backend.mutation(api.commands.syncCommands, {
        ...base,
        commands: unit.commands,
      });
      return { applied: true };
    default: {
      const result = await deps.backend.mutation(api.workspaces.patchWorkspaceGitState, {
        ...base,
        unit,
      });
      return { applied: result.applied };
    }
  }
}

/**
 * Builds the per-key send for the workspace-state outbox. Deliveries for one working
 * directory are serialized in enqueue order (kinds share one workspace); different
 * working directories run concurrently.
 */
// Reason: the daemon wires this send adapter in S5; unit tests use it until then.
// fallow-ignore-next-line unused-export
export function createWorkspaceStateSend(
  deps: WorkspaceStateSendDeps
): (key: string) => (unit: WorkspaceStateUnit) => Promise<WorkspaceStateSendResult> {
  const chains = new Map<string, Promise<unknown>>();
  return (key) => {
    const { workingDir } = decodeWorkspaceStateKey(key);
    return (unit) =>
      runInWorkingDirChain(chains, workingDir, () => deliverUnit(deps, workingDir, unit));
  };
}
