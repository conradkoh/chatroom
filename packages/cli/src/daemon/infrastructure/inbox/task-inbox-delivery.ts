import type { TaskInboxUpdate } from './task.js';
import type { NativeDeliveryService } from '../../entry/native-delivery/native-delivery-service.js';
import type { RecoveryCooldown } from '../../entry/task-delivery/task-delivery-logic.js';

export interface TaskInboxDeliveryDeps {
  readonly cooldown: RecoveryCooldown;
  readonly nativeDelivery: NativeDeliveryService;
}

/** Production task-inbox entry point. Dependencies are explicit and required. */
export async function handleTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: TaskInboxDeliveryDeps
): Promise<void> {
  await deps.nativeDelivery.handleTaskInboxUpdate(update, deps.cooldown);
}
