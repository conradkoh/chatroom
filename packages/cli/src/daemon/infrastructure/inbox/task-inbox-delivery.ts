import type { TaskInboxUpdate } from './task.js';
import type { NativeDeliveryService } from '../../entry/native-delivery/native-delivery-service.js';

export interface TaskInboxDeliveryDeps {
  readonly nativeDelivery: NativeDeliveryService;
}

/** Production task-inbox entry point. Dependencies are explicit and required. */
export async function handleTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: TaskInboxDeliveryDeps
): Promise<void> {
  await deps.nativeDelivery.handleTaskInboxUpdate(update);
}
