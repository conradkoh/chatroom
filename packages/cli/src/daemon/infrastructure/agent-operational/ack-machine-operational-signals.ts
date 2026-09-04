// fallow-ignore-file complexity
import type { FunctionReturnType } from 'convex/server';

import { api } from '../../../api.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';

type AckResult = FunctionReturnType<typeof api.machines.ackMachineOperationalSignals>;

export async function ackMachineOperationalSignals(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  chatroomId: string,
  throughSignalKey: string
): Promise<void> {
  while (true) {
    const result = (await sessionDeps.backend.mutation(api.machines.ackMachineOperationalSignals, {
      sessionId: sessionDeps.sessionId,
      machineId,
      chatroomId,
      throughSignalKey,
    })) as AckResult;
    if (!result.hasMore) return;
    if (result.deletedCount === 0) {
      throw new Error('Operational signal ack reported more work without progress');
    }
  }
}
