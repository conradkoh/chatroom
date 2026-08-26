/**
 * Zod wire contracts for daemon assigned-task monitor feeds.
 *
 * Wire types are derived from these schemas (single source of truth).
 *
 * @see docs/conventions/domain-models.md
 * @see docs/design/assigned-task-snapshot-contract-refactor-plan.md
 */
// fallow-ignore-file unused-export
// fallow-ignore-file unused-type

import { z } from 'zod';

import { convexIdSchema } from '../../entities/_shared/convex-id';

export const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;
export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];
export const activeTaskStatusSchema = z.enum(ACTIVE_TASK_STATUSES);

export const ASSIGNED_TASK_SIGNAL_TYPES = ['task', 'agent_config'] as const;
export type AssignedTaskSignalType = (typeof ASSIGNED_TASK_SIGNAL_TYPES)[number];
export const assignedTaskSignalTypeSchema = z.enum(ASSIGNED_TASK_SIGNAL_TYPES);

export const SESSION_AUGMENTATION_MODES = ['none', 'new_session'] as const;
export type SessionAugmentationMode = (typeof SESSION_AUGMENTATION_MODES)[number];
export const sessionAugmentationSchema = z.enum(SESSION_AUGMENTATION_MODES);

export const AGENT_DESIRED_STATES = ['running', 'stopped'] as const;
export type AgentDesiredState = (typeof AGENT_DESIRED_STATES)[number];
export const agentDesiredStateSchema = z.enum(AGENT_DESIRED_STATES);

export const AGENT_CIRCUIT_STATES = ['closed', 'open', 'half-open'] as const;
export type AgentCircuitState = (typeof AGENT_CIRCUIT_STATES)[number];
export const agentCircuitStateSchema = z.enum(AGENT_CIRCUIT_STATES);

const chatroomTaskIdSchema = convexIdSchema('chatroom_tasks');
const chatroomRoomIdSchema = convexIdSchema('chatroom_rooms');

export const assignedTaskAgentConfigSchema = z.object({
  role: z.string(),
  machineId: z.string(),
  agentHarness: z.string(),
  model: z.string().optional(),
  workingDir: z.string().optional(),
  // Legacy optional fields retained for daemon compatibility; backend snapshots no longer write them.
  spawnedAgentPid: z.number().optional(),
  desiredState: agentDesiredStateSchema.optional(),
  circuitState: agentCircuitStateSchema.optional(),
  configLifecycleRevision: z.number().optional(),
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

export const assignedTaskPresenceDeltaSchema = z.object({
  taskId: chatroomTaskIdSchema,
  role: z.string(),
  presenceKey: z.string(),
});

export type AssignedTaskPresenceDelta = z.infer<typeof assignedTaskPresenceDeltaSchema>;

export const assignedTaskSnapshotRowSchema = z
  .object({
    taskId: chatroomTaskIdSchema,
    chatroomId: chatroomRoomIdSchema,
    status: activeTaskStatusSchema,
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
export type AssignedTaskSnapshotView = z.output<typeof assignedTaskSnapshotRowSchema>;
export type AssignedTaskSignal = z.infer<typeof assignedTaskSignalSchema>;
export type AssignedTaskPresenceSignal = z.infer<typeof assignedTaskPresenceSignalSchema>;
export function isDeliverableTaskStatus(status: ActiveTaskStatus): boolean {
  return status === 'pending' || status === 'acknowledged';
}

export function isAgentDesiredRunning(desiredState: AgentDesiredState | undefined): boolean {
  return desiredState === 'running';
}

/** Parse incremental signal wire payloads; throws ZodError on mismatch. */
export function parseAssignedTaskSignal(raw: unknown): AssignedTaskSignal {
  return assignedTaskSignalSchema.parse(raw);
}

/** Parse incremental presence wire payloads; throws ZodError on mismatch. */
// fallow-ignore-next-line complexity
export function parseAssignedTaskPresenceSignal(raw: unknown): AssignedTaskPresenceSignal {
  const full = assignedTaskPresenceSignalSchema.safeParse(raw);
  if (full.success) return full.data;

  const delta = assignedTaskPresenceDeltaSchema.safeParse(raw);
  if (delta.success) {
    const presenceUpdatedAt = Number(delta.data.presenceKey.split(':')[0]);
    const resolvedAt = Number.isFinite(presenceUpdatedAt) ? presenceUpdatedAt : 0;
    return {
      taskId: delta.data.taskId,
      chatroomId: '' as z.infer<typeof chatroomRoomIdSchema>,
      role: delta.data.role,
      lastSeenAt: resolvedAt,
      presenceUpdatedAt: resolvedAt,
      presenceKey: delta.data.presenceKey,
    };
  }
  return assignedTaskPresenceSignalSchema.parse(raw);
}

/** Parse one hydrate snapshot row; throws ZodError on mismatch. */
function parseAssignedTaskSnapshotRow(raw: unknown): AssignedTaskSnapshotView {
  return assignedTaskSnapshotRowSchema.parse(raw);
}

/** Parse hydrate snapshot row list; throws on non-array or invalid rows. */
export function parseAssignedTaskSnapshotRows(raw: unknown): AssignedTaskSnapshotView[] {
  if (!Array.isArray(raw)) {
    throw new Error('Expected hydrate tasks array');
  }
  return raw.map((row) => parseAssignedTaskSnapshotRow(row));
}
