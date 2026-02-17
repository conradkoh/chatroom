/**
 * Daemon Utilities — shared helpers for the daemon command module.
 */

import type { MachineCommand, RawMachineCommand } from './types.js';

/**
 * Format timestamp for daemon log output.
 */
export function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Parse a raw command from Convex into the type-safe discriminated union.
 * Validates that required fields are present for each command type.
 * Returns null if the command has invalid/missing payload fields.
 */
export function parseMachineCommand(raw: RawMachineCommand): MachineCommand | null {
  switch (raw.type) {
    case 'ping':
      return { _id: raw._id, type: 'ping', payload: {}, createdAt: raw.createdAt };
    case 'status':
      return { _id: raw._id, type: 'status', payload: {}, createdAt: raw.createdAt };
    case 'start-agent': {
      const { chatroomId, role, agentHarness } = raw.payload;
      if (!chatroomId || !role || !agentHarness) {
        console.error(
          `   ⚠️  Invalid start-agent command: missing chatroomId, role, or agentHarness`
        );
        return null;
      }
      return {
        _id: raw._id,
        type: 'start-agent',
        payload: {
          chatroomId,
          role,
          agentHarness,
          model: raw.payload.model,
          workingDir: raw.payload.workingDir,
        },
        createdAt: raw.createdAt,
      };
    }
    case 'stop-agent': {
      const { chatroomId, role } = raw.payload;
      if (!chatroomId || !role) {
        console.error(`   ⚠️  Invalid stop-agent command: missing chatroomId or role`);
        return null;
      }
      return {
        _id: raw._id,
        type: 'stop-agent',
        payload: { chatroomId, role },
        createdAt: raw.createdAt,
      };
    }
    default:
      return null;
  }
}
