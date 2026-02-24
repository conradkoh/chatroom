/**
 * Database Migrations
 *
 * Internal mutations and actions for one-off data migrations.
 * Run from the Convex dashboard as internal functions.
 *
 * Previously executed migrations (removed after completion):
 * - Session expiration field removal (deprecated expiresAt/expiresAtLabel)
 * - User access level defaults (set undefined → 'user')
 * - Task origin normalization (set undefined → 'chat'/'backlog')
 * - Tool → Harness field rename (availableTools → availableHarnesses, etc.)
 */

import { internalMutation } from './_generated/server';

// ============================================================================
// PENDING MIGRATIONS — Run these after deploying to production
// ============================================================================

/**
 * Migration: Remove idle participants (no-op — status field removed).
 *
 * The `status` field and 'idle' state were removed as part of the
 * lastSeenAt-based lifecycle refactor. This migration is now a no-op
 * but is kept for historical reference.
 */
export const removeIdleParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allParticipants = await ctx.db.query('chatroom_participants').collect();

    return {
      total: allParticipants.length,
      deletedIdle: 0,
    };
  },
});

/**
 * Migration: Strip stale FSM fields from chatroom_participants.
 *
 * Phase 4 removed `status`, `readyUntil`, `activeUntil`, `cleanupDeadline`,
 * and `statusReason` from the schema. Existing documents written by the old
 * CLI still carry these fields, causing Convex schema validation errors.
 *
 * This migration rewrites each participant document keeping only the valid
 * schema fields, effectively dropping any stale extra fields.
 *
 * Run from the Convex dashboard:
 *   internal.migration.stripParticipantStaleFields
 */
export const stripParticipantStaleFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allParticipants = await ctx.db.query('chatroom_participants').collect();

    const STALE_FIELDS = new Set([
      'status',
      'readyUntil',
      'activeUntil',
      'cleanupDeadline',
      'statusReason',
      'desiredStatus',
      'pendingCommand',
    ]);

    let patched = 0;
    for (const participant of allParticipants) {
      const doc = participant as Record<string, unknown>;
      const hasStaleFields = [...STALE_FIELDS].some((f) => f in doc);

      if (hasStaleFields) {
        // Replace the document with only the valid schema fields.
        await ctx.db.replace('chatroom_participants', participant._id, {
          chatroomId: participant.chatroomId,
          role: participant.role,
          connectionId: participant.connectionId,
          agentType: participant.agentType,
          lastSeenAt: participant.lastSeenAt,
          lastSeenAction: participant.lastSeenAction,
        });
        patched++;
      }
    }

    return {
      total: allParticipants.length,
      patched,
    };
  },
});
