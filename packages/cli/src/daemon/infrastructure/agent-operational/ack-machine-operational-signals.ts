// fallow-ignore-file complexity
import { operationalSignalFeeds, type OperationalSignalKind } from './operational-signal-feeds.js';
import type { NativeTaskDeliverySessionDeps } from '../../services/service-interfaces.js';

export async function ackMachineSignal(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  chatroomId: string,
  throughSignalKey: string,
  kind: OperationalSignalKind
): Promise<void> {
  const feed = operationalSignalFeeds[kind];
  while (true) {
    const result = await feed.acknowledge(sessionDeps, {
      machineId,
      chatroomId,
      throughSignalKey,
    });
    if (!result.hasMore) return;
    if (result.deletedCount === 0) {
      throw new Error(`${kind} signal ack reported more work without progress`);
    }
  }
}
