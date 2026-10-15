// fallow-ignore-file complexity

import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { assignedTaskAssigneeSchema } from '@workspace/backend/src/domain/usecase/machine/assigned-task-contract.js';
import { z } from 'zod';

import { api, type Id } from '../../../../../api.js';
import {
  mapAssignedTaskList,
  mapAssignedTaskView,
} from '../../../../../infrastructure/mappers/map-assigned-task-view.js';
import type {
  AssignedTask,
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
    recordDeliveryFailure: async ({ sessionId, machineId, taskId, reason }) => {
      const result = await backend.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
        sessionId,
        machineId,
        taskId: taskId as Id<'chatroom_tasks'>,
        reason,
      });
      return Boolean((result as { recorded?: boolean }).recorded);
    },
    clearDeliveryFailure: async ({ sessionId, machineId, taskId, expectedReason }) => {
      const result = await backend.mutation(api.daemon.taskStatus.clearDeliveryFailure, {
        sessionId,
        machineId,
        taskId: taskId as Id<'chatroom_tasks'>,
        ...(expectedReason ? { expectedReason } : {}),
      });
      return Boolean((result as { cleared?: boolean }).cleared);
    },
    listActiveTaskStatuses: async ({ sessionId, machineId }) => {
      const rows = await backend.query(api.daemon.taskStatus.listActive, {
        sessionId,
        machineId,
      });
      return mapAssignedTaskList(rows as Parameters<typeof mapAssignedTaskList>[0]);
    },
    listPendingTaskInboxEvents: async ({ sessionId, machineId }) => {
      const rows = await backend.query(api.chatroomWorkspaceTaskInbox.listPending, {
        sessionId,
        machineId,
      });
      return mapPendingTaskInboxRows(rows);
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
        status: AssignedTask['status'];
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
    readTask: async (args) =>
      (await backend.mutation(api.tasks.readTask, args)) as { status: 'in_progress' },
    markReceiptStarted: async (args) =>
      (await backend.mutation(api.taskDeliveryReceipts.markStarted, args)) as { marked: boolean },
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

/**
 * Slim task header on a `listPending` row. `z.object` strips unknown keys, so legacy
 * fat-row fields (content, taskEnvelope, …) and future backend additions are dropped
 * here instead of failing delivery on CLI/backend version skew.
 */
const pendingTaskInboxTaskSchema = z.object({
  taskId: z.string(),
  chatroomId: z.string(),
  status: z.string(),
  assignedTo: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  startInNewSession: z.boolean().optional(),
});

/** Declared structure of one `chatroomWorkspaceTaskInbox.listPending` row. */
const pendingTaskInboxRowSchema = z.object({
  _id: z.string(),
  machineId: z.string(),
  chatroomId: z.string(),
  taskId: z.string(),
  role: z.string(),
  assignee: assignedTaskAssigneeSchema.optional(),
  eventType: z.enum(WorkspaceTaskInboxEventType),
  status: z.enum(WorkspaceTaskInboxEventStatus),
  createdAt: z.number(),
  task: pendingTaskInboxTaskSchema,
});

/** Wire input accepted by the parser; type-tested against the backend `listPending` return type. */
// fallow-ignore-next-line unused-type
export type PendingTaskInboxRow = z.input<typeof pendingTaskInboxRowSchema>;

function toWorkspaceTaskInboxEvent({
  _id: eventId,
  ...row
}: z.output<typeof pendingTaskInboxRowSchema>): WorkspaceTaskInboxEvent {
  return { ...row, eventId };
}

/**
 * Parses backend pending rows into daemon events. A malformed row is logged and skipped,
 * so one bad row cannot stall delivery of the rest. It stays pending in the backend.
 * Throws only when the payload is not an array.
 */
export function mapPendingTaskInboxRows(rows: unknown): WorkspaceTaskInboxEvent[] {
  return z
    .array(z.unknown())
    .parse(rows)
    .flatMap((raw) => {
      const parsed = pendingTaskInboxRowSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `[TaskService] skipping malformed task inbox row: ${z.prettifyError(parsed.error)}`
        );
        return [];
      }
      return [toWorkspaceTaskInboxEvent(parsed.data)];
    });
}
