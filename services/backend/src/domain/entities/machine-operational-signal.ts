import { v } from 'convex/values';

/**
 * Required scope for every machine operational-signal read or acknowledgement.
 * Keeping this validator shared prevents one endpoint from silently becoming
 * machine-wide while the others remain chatroom-scoped.
 */
export const machineOperationalSignalScopeValidator = {
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
} as const;
