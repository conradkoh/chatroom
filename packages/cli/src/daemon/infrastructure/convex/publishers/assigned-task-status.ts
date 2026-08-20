import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { logDaemonAuditEvent } from '../../event-stream/daemon-event-emitter.js';

export function createAssignedTaskStatusPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'task.status') return;

      if (event.outcome === 'delivered') {
        await logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
          type: 'agent.taskDelivered',
          chatroomId: event.chatroomId,
          role: event.role,
          machineId: deps.machineId,
          taskId: event.taskId,
        });
        return;
      }

      await logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
        type: 'agent.taskDeliveryFailed',
        chatroomId: event.chatroomId,
        role: event.role,
        machineId: deps.machineId,
        taskId: event.taskId,
        error: event.error ?? 'Task delivery failed',
      });
    },
  };
}
