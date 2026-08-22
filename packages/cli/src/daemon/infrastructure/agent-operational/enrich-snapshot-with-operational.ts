import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import { getNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import { isOperationalDesiredRunning } from './agent-operational-read-model.js';
export function enrichSnapshotWithOperational(snapshot: AssignedTaskSnapshotView): AssignedTaskSnapshotView {
  const op = getNativeDeliverySession()?.agentOperationalReadModel?.get(snapshot.chatroomId, snapshot.agentConfig.role);
  if (!op) return snapshot;
  return { ...snapshot, agentConfig: { ...snapshot.agentConfig, desiredState: isOperationalDesiredRunning(op) ? 'running' : 'stopped' } };
}
export function enrichSnapshotsWithOperational(snapshots: readonly AssignedTaskSnapshotView[]): AssignedTaskSnapshotView[] { return snapshots.map(enrichSnapshotWithOperational); }
