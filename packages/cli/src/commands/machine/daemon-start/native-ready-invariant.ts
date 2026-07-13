import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

function slotMatchesSpawnedAgent(
  spawnedAgentPid: number,
  slot: AgentSlot | undefined
): slot is AgentSlot & { harnessSessionId: string; pid: number } {
  return (
    slot?.state === 'running' &&
    slot.pid === spawnedAgentPid &&
    typeof slot.harnessSessionId === 'string' &&
    slot.harnessSessionId.length > 0
  );
}

function participantAllowsNativeDelivery(
  participant: AssignedTaskSnapshotView['participant']
): boolean {
  const action = participant?.lastSeenAction;
  return action == null || action === NATIVE_WAITING_ACTION;
}

/** Agent is ready for native task delivery (post-restart or steady-state). */
export function isAgentReadyForNativeDelivery(
  task: AssignedTaskSnapshotView,
  slot: AgentSlot | undefined
): boolean {
  const { agentConfig } = task;
  if (!isNativeHarness(agentConfig.agentHarness)) return false;
  if (agentConfig.desiredState !== 'running') return false;
  if (agentConfig.spawnedAgentPid == null) return false;
  if (!slotMatchesSpawnedAgent(agentConfig.spawnedAgentPid, slot)) return false;
  return participantAllowsNativeDelivery(task.participant);
}

/** Pending or acknowledged tasks eligible for (re)delivery when agent is ready. */
export function isDeliverableNativeTaskStatus(status: AssignedTaskSnapshotView['status']): boolean {
  return status === 'pending' || status === 'acknowledged';
}
