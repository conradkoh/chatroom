import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isTurnPhaseIdle } from '../../../daemon/domain/usecase/check-agent-slot.js';
import type { AgentSlot } from '../../infrastructure/agent-process-manager/agent-process-manager.js';

/** True when a pending task is blocked by a stale local turn phase. */
export function isStaleTurnInFlightWhileWaiting(
  task: AssignedTaskSnapshotView,
  slot: AgentSlot | undefined
): boolean {
  if (!slot || isTurnPhaseIdle(slot.nativeTurnPhase ?? 'idle')) return false;
  if (task.status !== 'pending') return false;
  return true;
}
