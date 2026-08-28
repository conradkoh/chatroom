import { HARNESS_SESSION_READY_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import {
  AgentStartReasonEnum,
  AgentStopReasonEnum,
} from '@workspace/backend/src/domain/entities/agent.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';

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
  role: string
): Promise<string | null> {
  const deadline = Date.now() + HARNESS_SESSION_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const id = agentMgr.getSlot(chatroomId, role)?.harnessSessionId;
    if (id) return id;
    await sleep(100);
  }
  return null;
}

/** Cold-restart native harness when user opted in via task.startInNewSession. */
// fallow-ignore-next-line complexity
export async function ensureColdSessionBeforeNativeInject(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps
): Promise<string | null> {
  if (!task.startInNewSession) return null;

  const { chatroomId, agentConfig, taskId } = task;
  const { role, agentHarness, model, workingDir } = agentConfig;
  if (!workingDir || !model) return null;

  await deps.agentMgr.stop({
    chatroomId,
    role,
    reason: AgentStopReasonEnum['platform.task_start_in_new_session'],
  });

  const spawn = await deps.agentMgr.ensureRunning({
    chatroomId,
    role,
    agentHarness: agentHarness as AgentHarness,
    model,
    workingDir,
    reason: AgentStartReasonEnum['platform.task_start_in_new_session'],
    wantResume: false,
  });
  if (!spawn.success) return null;

  const harnessSessionId = await waitForHarnessSessionId(deps.agentMgr, chatroomId, role);
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
