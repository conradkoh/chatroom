// fallow-ignore-file complexity
import { api } from '../../../api.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';

export async function ackMachineOperationalSignals(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  throughSignalKey: string
): Promise<void> {
  let hasMore = true;
  while (hasMore) {
    const result = await sessionDeps.backend.mutation(api.machines.ackMachineOperationalSignals, {
      sessionId: sessionDeps.sessionId,
      machineId,
      throughSignalKey,
    });
    hasMore = Boolean((result as { hasMore?: boolean })?.hasMore);
    if (!hasMore) break;
    if (((result as { deletedCount?: number })?.deletedCount ?? 0) === 0) break;
  }
}
