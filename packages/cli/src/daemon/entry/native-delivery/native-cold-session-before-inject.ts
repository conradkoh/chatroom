import { HARNESS_SESSION_READY_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import {
  AgentStartReasonEnum,
  AgentStopReasonEnum,
} from '@workspace/backend/src/domain/entities/agent.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { taskRequestsNativeColdSession } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';

import { api } from '../../../api.js';
import type { AssignedTaskWithContent } from '../../../daemon/domain/entities/assigned-task.js';
import { logDaemonAuditEvent } from '../../infrastructure/event-stream/daemon-event-emitter.js';
import type { AgentHarness } from '../daemon-types.js';
import type { NativeInjectorDeps } from './native-task-injector.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHarnessSessionId(
  agentMgr: NativeInjectorDeps['agentMgr'],
  chatroomId: string,
  role: string,
  signal: AbortSignal
): Promise<string | null> {
  const deadline = Date.now() + HARNESS_SESSION_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason ?? new Error('Agent operation cancelled');
    const id = agentMgr.getSlot(chatroomId, role)?.harnessSessionId;
    if (id) return id;
    await sleep(100);
  }
  return null;
}

/**
 * Cold-restart native harness when the task requests a new session.
 *
 * Constraints:
 * - Missing/idle slots start directly with `wantResume: false` (no stop).
 * - A running old session must stop successfully before starting; a failed
 *   stop never proceeds to start/inject.
 * - Spawning or stopping slots are transitions: wait for reconciliation
 *   instead of launching another operation.
 */
// fallow-ignore-next-line complexity
export async function ensureColdSessionBeforeNativeInject(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps
): Promise<string | null> {
  if (
    !taskRequestsNativeColdSession({
      content: task.taskContent ?? '',
      taskEnvelope: task.taskEnvelope,
      startInNewSession: task.startInNewSession,
    })
  ) {
    return null;
  }

  const { chatroomId, agentConfig, taskId } = task;
  const { role, agentHarness, model, workingDir } = agentConfig;
  if (!workingDir || !model) return null;

  const slot = deps.agentMgr.getSlot(chatroomId, role);
  const slotState = slot?.state;
  if (slotState === 'spawning' || slotState === 'stopping') {
    return null;
  }
  let harnessSessionId: string | null;
  try {
    harnessSessionId = await deps.runSerializedForAgent(
      { chatroomId, role },
      { timeoutMs: HARNESS_SESSION_READY_TIMEOUT_MS },
      async (ops, context) => {
        if (slotState === 'running') {
          await ops.stopAgent(
            {
              chatroomId,
              role,
              reason: AgentStopReasonEnum['platform.task_start_in_new_session'],
            },
            context.signal
          );
        }

        await ops.startAgent(
          {
            chatroomId,
            role,
            agentHarness: agentHarness as AgentHarness,
            model,
            workingDir,
            reason: AgentStartReasonEnum['platform.task_start_in_new_session'],
            wantResume: false,
          },
          context.signal
        );

        return waitForHarnessSessionId(deps.agentMgr, chatroomId, role, context.signal);
      }
    );
  } catch {
    return null;
  }
  if (!harnessSessionId) return null;

  await deps.backend.mutation(api.participants.join, {
    sessionId: deps.sessionId,
    chatroomId,
    role,
    action: NATIVE_WAITING_ACTION,
    taskId,
  });

  await logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
    type: 'agent.sessionAugmented',
    chatroomId,
    role,
    machineId: deps.machineId,
    taskId,
    mode: 'new_session',
    newSessionStarted: true,
    harnessSessionId,
  });
  await deps.backend.mutation(api.daemon.agentEvents.sessionAugmented, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    chatroomId,
    role,
    taskId,
    mode: 'new_session',
    newSessionStarted: true,
    harnessSessionId,
  });

  return harnessSessionId;
}
