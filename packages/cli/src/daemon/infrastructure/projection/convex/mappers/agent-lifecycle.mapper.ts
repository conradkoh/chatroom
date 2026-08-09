import { api } from '../../../../../api.js';
import type { OutboundEvent } from '../../../../domain/entities/outbound-event.js';

export type AgentLifecycleMutationSpec = {
  mutation: unknown;
  args: Record<string, unknown>;
};

/**
 * Map a local lifecycle outbound event to the matching Convex mutation + args.
 * Wraps the existing emit* / participants.handleNativeAgentEnd mutations —
 * no Convex business rules are rewritten.
 */
// fallow-ignore-next-line complexity
export function mapAgentLifecycleEventToMutation(
  deps: { sessionId: string; machineId: string },
  event: OutboundEvent
): AgentLifecycleMutationSpec | undefined {
  const { sessionId, machineId } = deps;
  switch (event.type) {
    case 'agent.start_failed':
      return {
        mutation: api.machines.emitAgentStartFailed,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          error: event.error,
        },
      };
    case 'agent.stop_timeout':
      return {
        mutation: api.machines.emitAgentStopTimeout,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          pid: event.pid,
          durationMs: event.durationMs,
        },
      };
    case 'session.resume_requested':
      return {
        mutation: api.machines.emitSessionResumeRequested,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          agentHarness: event.agentHarness,
          ...(event.harnessSessionId ? { harnessSessionId: event.harnessSessionId } : {}),
        },
      };
    case 'session.resumed':
      return {
        mutation: api.machines.emitSessionResumed,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          ...(event.harnessSessionId ? { harnessSessionId: event.harnessSessionId } : {}),
        },
      };
    case 'session.resume_failed':
      return {
        mutation: api.machines.emitSessionResumeFailed,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          reason: event.reason,
          ...(event.harnessSessionId ? { harnessSessionId: event.harnessSessionId } : {}),
        },
      };
    case 'session.reopen_retry':
      return {
        mutation: api.machines.emitSessionReopenRetry,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          ...(event.error ? { error: event.error } : {}),
          ...(event.harnessSessionId ? { harnessSessionId: event.harnessSessionId } : {}),
        },
      };
    case 'harness.session_id_updated':
      return {
        mutation: api.machines.emitHarnessSessionIdUpdated,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          correlationId: event.correlationId,
          ...(event.previousResumableId ? { previousResumableId: event.previousResumableId } : {}),
          resumableId: event.resumableId,
          source: event.source,
        },
      };
    case 'restart.limit_reached':
      return {
        mutation: api.machines.emitRestartLimitReached,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          restartCount: event.restartCount,
          windowMs: event.windowMs,
        },
      };
    case 'agent.native_end':
      return {
        mutation: api.participants.handleNativeAgentEnd,
        args: {
          sessionId,
          chatroomId: event.chatroomId,
          role: event.role,
          ...(event.taskId ? { taskId: event.taskId } : {}),
        },
      };
    case 'restart.phase':
      return {
        mutation: api.machines.emitRestartPhase,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          correlationId: event.correlationId,
          phase: event.phase,
          ...(event.detail ? { detail: event.detail } : {}),
        },
      };
    case 'restart.completed':
      return {
        mutation: api.machines.emitRestartCompleted,
        args: {
          sessionId,
          machineId,
          chatroomId: event.chatroomId,
          role: event.role,
          correlationId: event.correlationId,
          ...(event.deliveredTaskIds ? { deliveredTaskIds: event.deliveredTaskIds } : {}),
        },
      };
    default:
      return undefined;
  }
}
