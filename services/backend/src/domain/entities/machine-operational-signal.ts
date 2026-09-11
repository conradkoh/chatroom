// fallow-ignore-file unused-export unused-type
/**
 * Purpose-specific signal rows consumed by the machine daemon.
 *
 * The tables are intentionally separate, but the literal `kind` field keeps
 * their wire shapes explicit and gives callers a discriminant when rows from
 * multiple feeds are handled together.
 */

import { v } from 'convex/values';

import { toLiteralValidators } from './_shared/v-literals-of';

/** Required scope for every machine operational-signal endpoint. */
export const machineOperationalSignalScopeValidator = {
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
} as const;

export const MACHINE_OPERATIONAL_SIGNAL_KINDS = [
  'agent-operational',
  'agent-stop',
  'agent-removal',
] as const;

export type MachineOperationalSignalKind = (typeof MACHINE_OPERATIONAL_SIGNAL_KINDS)[number];

export const machineOperationalSignalKindValidator = v.union(
  ...toLiteralValidators(MACHINE_OPERATIONAL_SIGNAL_KINDS)
);

/** Fields shared by every feed for cursoring, scoping, and hydration. */
export const machineOperationalSignalSyncFields = {
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
  role: v.string(),
  revisionKey: v.string(),
  signalKey: v.string(),
  projectedAt: v.number(),
} as const;

export const machineAgentOperationalSignalValidator = v.object({
  ...machineOperationalSignalSyncFields,
  kind: v.literal('agent-operational'),
});

export const machineAgentStopSignalValidator = v.object({
  ...machineOperationalSignalSyncFields,
  kind: v.literal('agent-stop'),
  stopState: v.union(
    v.literal('idle'),
    v.literal('pending'),
    v.literal('stopping'),
    v.literal('stopped'),
    v.literal('failed')
  ),
});

export const machineAgentRemovalSignalValidator = v.object({
  ...machineOperationalSignalSyncFields,
  kind: v.literal('agent-removal'),
  reason: v.literal('role-removed'),
});

export const machineOperationalSignalValidator = v.union(
  machineAgentOperationalSignalValidator,
  machineAgentStopSignalValidator,
  machineAgentRemovalSignalValidator
);

export type MachineAgentOperationalSignal = typeof machineAgentOperationalSignalValidator.type;
export type MachineAgentStopSignal = typeof machineAgentStopSignalValidator.type;
export type MachineAgentRemovalSignal = typeof machineAgentRemovalSignalValidator.type;
export type MachineOperationalSignal = typeof machineOperationalSignalValidator.type;
