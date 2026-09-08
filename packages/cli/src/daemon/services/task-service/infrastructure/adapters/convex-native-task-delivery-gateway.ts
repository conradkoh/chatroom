import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { api } from '../../../../../api.js';
import type { NativeTaskDeliveryGateway } from '../../service/ports/native-task-delivery.js';

type Backend = {
  mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

export function createConvexNativeTaskDeliveryGateway(backend: Backend): NativeTaskDeliveryGateway {
  return {
    claimPendingTask: async (args) => {
      await backend.mutation(api.tasks.claimTask, args);
    },
    loadDeliveryPrompt: (args) =>
      backend.query(api.messages.getTaskDeliveryPrompt, args) as Promise<{ fullCliOutput: string }>,
    recordReceipt: async (args) => {
      await backend.mutation(api.taskDeliveryReceipts.record, {
        ...args,
        deliveryKind: 'native_inject',
      });
    },
    joinWaitingParticipant: async (args) => {
      await backend.mutation(api.participants.join, {
        ...args,
        action: NATIVE_WAITING_ACTION,
      });
    },
    recordSessionAugmentation: async (args) => {
      await backend.mutation(api.daemon.agentEvents.sessionAugmented, args);
    },
  };
}
