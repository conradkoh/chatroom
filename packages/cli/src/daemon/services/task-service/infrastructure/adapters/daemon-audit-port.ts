import { logDaemonAuditEvent } from '../../../../infrastructure/event-stream/daemon-event-emitter.js';
import type { NativeTaskDeliveryAuditPort } from '../../service/ports/native-task-delivery.js';

export function createDaemonAuditPort(
  logEvent: (event: Record<string, unknown>) => Promise<void>
): NativeTaskDeliveryAuditPort {
  return { emit: (event) => logDaemonAuditEvent(logEvent, event) };
}
