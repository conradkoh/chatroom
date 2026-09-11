// fallow-ignore-file complexity

import type {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';

import { api, type Id } from '../../../../../api.js';
import { mapAssignedTaskView } from '../../../../../infrastructure/mappers/map-assigned-task.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { NativeTaskDeliveryGateway } from '../../service/ports/native-task-delivery.js';
import type { WorkspaceTaskInboxEvent } from '../../service/task-service.js';

type Backend = {
  mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

export function createConvexNativeTaskDeliveryGateway(backend: Backend): NativeTaskDeliveryGateway {
  return {
    listPendingTaskInboxEvents: async ({ sessionId, machineId }) => {
      const rows = await backend.query(api.chatroomWorkspaceTaskInbox.listPending, {
        sessionId,
        machineId,
      });
      return (rows as Record<string, unknown>[]).map((row) => ({
        eventId: row._id as string,
        machineId: row.machineId as string,
        chatroomId: row.chatroomId as string,
        taskId: row.taskId as string,
        role: row.role as string,
        ...(row.ephemeral === undefined
          ? {}
          : {
              ephemeral: row.ephemeral as {
                agentHarness: string;
                model: string;
                workingDir: string;
              },
            }),
        eventType: row.eventType as WorkspaceTaskInboxEventType,
        status: row.status as WorkspaceTaskInboxEventStatus,
        createdAt: row.createdAt as number,
        ...(row.processedAt === undefined ? {} : { processedAt: row.processedAt as number }),
        task: row.task as WorkspaceTaskInboxEvent['task'],
      }));
    },
    markTaskInboxEventProcessed: async ({ sessionId, machineId, eventId }) => {
      const result = await backend.mutation(api.chatroomWorkspaceTaskInbox.markProcessed, {
        sessionId,
        machineId,
        eventId: eventId as Id<'chatroomWorkspaceTaskInbox'>,
      });
      return Boolean((result as { processed?: boolean }).processed);
    },
    claimPendingTask: async (args) => {
      await backend.mutation(api.tasks.claimTask, args);
    },
    releaseTaskAfterTurnFailure: (args) =>
      backend.mutation(api.tasks.releaseTaskAfterTurnFailure, args) as Promise<{
        released: boolean;
        status: AssignedTaskSnapshotView['status'];
        updatedAt: number;
      }>,
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
    loadAssignedTaskForAction: async (args) => {
      const row = (await backend.query(api.machines.getAssignedTaskForAction, {
        sessionId: args.sessionId,
        machineId: args.machineId,
        taskId: args.taskId as Id<'chatroom_tasks'>,
        role: args.role,
      })) as Parameters<typeof mapAssignedTaskView>[0] | null;
      if (!row) return null;
      return mapAssignedTaskView(row) satisfies AssignedTaskWithContent;
    },
  };
}
