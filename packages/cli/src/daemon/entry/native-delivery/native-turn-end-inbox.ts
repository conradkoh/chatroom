import type { ChatroomRole } from '@workspace/shared/domain/chatroom-role';

import { getNativeDeliverySession } from './native-delivery-session-registry.js';
import type { ActiveTaskStatus } from '../../domain/entities/assigned-task.js';

export type NativeTurnEndInboxDecision = 'needs-handoff-reminder' | 'handoff-completed' | 'unknown';

const ACTIVE_TASK_DECISIONS = {
  pending: 'unknown',
  acknowledged: 'unknown',
  in_progress: 'needs-handoff-reminder',
} as const satisfies Record<ActiveTaskStatus, NativeTurnEndInboxDecision>;

/**
 * Resolves turn-end handling from the inbox-owned active-task read model.
 *
 * A missing previously delivered task is positive evidence that its handoff
 * completed. Pending/acknowledged rows remain ambiguous because they may have
 * ended before the harness produced work, so those retain the backend fallback.
 */
// fallow-ignore-next-line complexity
export function decideNativeTurnEndFromInbox(params: {
  chatroomId: string;
  role: ChatroomRole;
  taskId: string | undefined;
}): NativeTurnEndInboxDecision {
  const session = getNativeDeliverySession();
  if (!params.taskId || !session) return 'unknown';

  const { taskSnapshotState } = session;
  if (!taskSnapshotState.isInitialized()) return 'unknown';

  const task = taskSnapshotState.getForRole(params.chatroomId, params.role, params.taskId);
  return task ? ACTIVE_TASK_DECISIONS[task.status] : 'handoff-completed';
}
