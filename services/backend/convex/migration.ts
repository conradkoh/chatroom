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
 * Remove participants with deprecated "idle" status.
 *
 * The "idle" status was removed in this PR. Any existing participants with
 * status "idle" should be deleted so the deprecated v.literal('idle') can
 * be removed from the schema in a follow-up change.
 *
 * Run from the Convex dashboard:
 *   migration:removeIdleParticipants
 *
 * After running successfully, the v.literal('idle') in the chatroom_participants
 * schema can be removed in a follow-up PR.
 */
export const removeIdleParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allParticipants = await ctx.db.query('chatroom_participants').collect();

    let deleted = 0;
    for (const participant of allParticipants) {
      if (participant.status === 'idle') {
        await ctx.db.delete('chatroom_participants', participant._id);
        deleted++;
      }
    }

    return {
      total: allParticipants.length,
      deletedIdle: deleted,
    };
  },
});
