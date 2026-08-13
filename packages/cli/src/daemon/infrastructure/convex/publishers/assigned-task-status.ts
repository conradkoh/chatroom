import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api, type Id } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { isDaemonTaskId } from '../../../domain/entities/daemon-task-id.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';

function isUnknownDaemonTaskError(error: unknown): boolean {
  return getErrorMessage(error).includes('Unknown daemon task');
}

export function createAssignedTaskStatusPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'task.status') return;
      if (event.variant === 'transition') {
        if (!isDaemonTaskId(event.taskId)) return;
        try {
          await deps.backend.mutation(api.machines.projectTaskStatusFromDaemon, {
            sessionId: deps.sessionId, machineId: deps.machineId, idempotencyKey: event.idempotencyKey,
            daemonTaskId: event.taskId, status: event.status, timestamp: event.timestamp,
          });
        } catch (error) {
          if (!isUnknownDaemonTaskError(error)) throw error;
        }
        return;
      }

      if (event.outcome === 'delivered') {
        await deps.backend.mutation(api.machines.emitTaskDelivered, {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          chatroomId: event.chatroomId as Id<'chatroom_rooms'>,
          role: event.role,
          taskId: event.taskId,
        });
        return;
      }

      await deps.backend.mutation(api.machines.emitTaskDeliveryFailed, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        chatroomId: event.chatroomId as Id<'chatroom_rooms'>,
        role: event.role,
        taskId: event.taskId,
        error: event.error ?? 'Task delivery failed',
      });
    },
  };
}
