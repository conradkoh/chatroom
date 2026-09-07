import {
  isOperationalDesiredRunning,
  type AgentOperationalReadModel,
} from './agent-operational-read-model.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';

// fallow-ignore-next-line unused-export
export function enrichSnapshotWithOperational(
  snapshot: AssignedTaskSnapshotView,
  operationalModel: AgentOperationalReadModel
): AssignedTaskSnapshotView {
  const op = operationalModel.get(snapshot.chatroomId, snapshot.agentConfig.role);
  if (!op) return snapshot;
  return {
    ...snapshot,
    agentConfig: {
      ...snapshot.agentConfig,
      desiredState: isOperationalDesiredRunning(op) ? 'running' : 'stopped',
    },
  };
}
export function enrichSnapshotsWithOperational(
  snapshots: readonly AssignedTaskSnapshotView[],
  operationalModel: AgentOperationalReadModel
): AssignedTaskSnapshotView[] {
  return snapshots.map((snapshot) => enrichSnapshotWithOperational(snapshot, operationalModel));
}
