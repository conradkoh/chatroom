/**
 * Handles an agent.requestStart event from chatroom_eventStream.
 * Delegates to AgentProcessManager for lifecycle management.
 * Deadline check is kept at the caller level (transport concern).
 */

import { Effect } from 'effect';

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  type DaemonSessionServiceShape,
} from '../../../commands/machine/daemon-start/daemon-services.js';
import type {
  AgentHarness,
  StartAgentReason,
} from '../../../commands/machine/daemon-start/types.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';

export interface AgentRequestStartEventPayload {
  _id: Id<'chatroom_eventStream'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  wantResume?: boolean;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Notify backend of failed agent start (fire-and-forget). */
function notifyAgentStartFailed(
  backend: BackendOps,
  opts: {
    sessionId: string;
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    error: string;
  }
): void {
  backend.mutation(api.machines.emitAgentStartFailed, opts).catch((err: Error) => {
    console.log(`   ⚠️  Failed to emit startFailed event: ${err.message}`);
  });
}

/** Register workspace with backend (fire-and-forget). */
function notifyWorkspaceRegistered(
  backend: BackendOps,
  opts: {
    sessionId: string;
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    workingDir: string;
    hostname: string;
    registeredBy: string;
  }
): void {
  backend.mutation(api.workspaces.registerWorkspace, opts).catch((err: Error) => {
    console.warn(`[daemon] ⚠️ Failed to register workspace: ${err.message}`);
  });
}

/** Dispatch post-ensureRunning notifications (fire-and-forget). */
function dispatchStartNotifications(
  backend: BackendOps,
  session: { sessionId: string; machineId: string; config: DaemonSessionServiceShape['config'] },
  event: AgentRequestStartEventPayload,
  result: { success: boolean; error?: string }
): void {
  if (!result.success) {
    console.log(
      `[daemon] Agent start rejected for role=${event.role}: ${result.error ?? 'unknown'}`
    );
    notifyAgentStartFailed(backend, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      chatroomId: event.chatroomId,
      role: event.role,
      error: result.error ?? 'unknown',
    });
  } else {
    notifyWorkspaceRegistered(backend, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      chatroomId: event.chatroomId,
      workingDir: event.workingDir,
      hostname: session.config?.hostname ?? 'unknown',
      registeredBy: event.role,
    });
  }
}

// ── Effect twin ──────────────────────────────────────────────────────────────

/**
 * Effect twin for onRequestStartAgent — uses DaemonAgentProcessManagerService
 * and DaemonSessionService instead of DaemonContext.
 */
export const onRequestStartAgentEffect = (
  event: AgentRequestStartEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService | DaemonSessionService> =>
  Effect.gen(function* () {
    const eventId = event._id.toString();

    if (Date.now() > event.deadline) {
      console.log(
        `[daemon] ⏰ Skipping expired agent.requestStart for role=${event.role} (id: ${eventId}, deadline passed)`
      );
      return;
    }

    console.log(`[daemon] Processing agent.requestStart (id: ${eventId})`);

    const agentPm = yield* DaemonAgentProcessManagerService;
    const session = yield* DaemonSessionService;

    const result = yield* agentPm.ensureRunning({
      chatroomId: event.chatroomId,
      role: event.role,
      agentHarness: event.agentHarness,
      model: event.model,
      workingDir: event.workingDir,
      reason: event.reason as StartAgentReason,
      wantResume: event.wantResume ?? true,
    });

    dispatchStartNotifications(session.backend, session, event, result);
  });
