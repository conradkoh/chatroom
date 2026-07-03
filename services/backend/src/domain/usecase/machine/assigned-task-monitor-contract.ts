/**
 * Zod wire contracts for daemon assigned-task monitor feeds.
 *
 * Wire types are derived from these schemas (single source of truth).
 *
 * @see docs/conventions/domain-models.md
 * @see docs/design/assigned-task-monitor-contract-refactor-plan.md
 */
// fallow-ignore-file unused-export
// fallow-ignore-file unused-type

import { z } from 'zod';

import { convexIdSchema } from '../../entities/_shared/convex-id';

const activeTaskStatusSchema = z.enum(['pending', 'acknowledged', 'in_progress']);
const assignedTaskSignalTypeSchema = z.enum(['task', 'agent_config']);
const sessionAugmentationSchema = z.enum(['none', 'compact', 'new_session']);

const chatroomTaskIdSchema = convexIdSchema('chatroom_tasks');
const chatroomRoomIdSchema = convexIdSchema('chatroom_rooms');

export const assignedTaskAgentConfigSchema = z.object({
  role: z.string(),
  machineId: z.string(),
  agentHarness: z.string(),
  model: z.string().optional(),
  workingDir: z.string().optional(),
  spawnedAgentPid: z.number().optional(),
  desiredState: z.string().optional(),
  circuitState: z.string().optional(),
});

export const assignedTaskParticipantSchema = z.object({
  lastSeenAction: z.string().nullable(),
  lastSeenAt: z.number().nullable(),
  lastStatus: z.string().nullable(),
});

/** Fields required to bootstrap a daemon working row from a signal alone. */
export const assignedTaskSignalBootstrapFields = {
  taskId: chatroomTaskIdSchema,
  chatroomId: chatroomRoomIdSchema,
  role: z.string(),
  status: activeTaskStatusSchema,
  signalType: assignedTaskSignalTypeSchema,
  revisionKey: z.string(),
  machineId: z.string(),
  agentHarness: z.string(),
  createdAt: z.number(),
  workingDir: z.string().optional(),
  assignedTo: z.string().optional(),
  lastSeenAction: z.string().nullable().optional(),
  lastStatus: z.string().nullable().optional(),
  spawnedAgentPid: z.number().optional(),
  desiredState: z.string().optional(),
  sessionAugmentation: sessionAugmentationSchema.optional(),
} as const;

export const assignedTaskSignalSchema = z.object(assignedTaskSignalBootstrapFields);

export const assignedTaskPresenceSignalSchema = z.object({
  taskId: chatroomTaskIdSchema,
  chatroomId: chatroomRoomIdSchema,
  role: z.string(),
  lastSeenAt: z.number().nullable(),
  lastSeenAction: z.string().nullable().optional(),
  presenceUpdatedAt: z.number(),
  presenceKey: z.string(),
});

export const assignedTaskMonitorRowSchema = z
  .object({
    taskId: chatroomTaskIdSchema,
    chatroomId: chatroomRoomIdSchema,
    status: z.string(),
    assignedTo: z.string().optional(),
    updatedAt: z.number(),
    createdAt: z.number(),
    agentConfig: assignedTaskAgentConfigSchema,
    participant: assignedTaskParticipantSchema.optional(),
  })
  .transform((row) => ({
    ...row,
    assignedTo: row.assignedTo,
  }));

export type AssignedTaskAgentConfigView = z.infer<typeof assignedTaskAgentConfigSchema>;
export type AssignedTaskParticipantView = z.infer<typeof assignedTaskParticipantSchema>;
export type AssignedTaskSnapshotView = z.output<typeof assignedTaskMonitorRowSchema>;
export type AssignedTaskSignal = z.infer<typeof assignedTaskSignalSchema>;
export type AssignedTaskPresenceSignal = z.infer<typeof assignedTaskPresenceSignalSchema>;
export type AssignedTaskSignalType = AssignedTaskSignal['signalType'];

/** Parse incremental signal wire payloads; throws ZodError on mismatch. */
export function parseAssignedTaskSignal(raw: unknown): AssignedTaskSignal {
  return assignedTaskSignalSchema.parse(raw);
}

/** Parse incremental presence wire payloads; throws ZodError on mismatch. */
export function parseAssignedTaskPresenceSignal(raw: unknown): AssignedTaskPresenceSignal {
  return assignedTaskPresenceSignalSchema.parse(raw);
}

/** Parse one hydrate snapshot row; throws ZodError on mismatch. */
function parseAssignedTaskMonitorRow(raw: unknown): AssignedTaskSnapshotView {
  return assignedTaskMonitorRowSchema.parse(raw);
}

/** Parse hydrate snapshot row list; throws on non-array or invalid rows. */
export function parseAssignedTaskMonitorRows(raw: unknown): AssignedTaskSnapshotView[] {
  if (!Array.isArray(raw)) {
    throw new Error('Expected hydrate tasks array');
  }
  return raw.map((row) => parseAssignedTaskMonitorRow(row));
}
