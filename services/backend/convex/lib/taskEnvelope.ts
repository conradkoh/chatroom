/**
 * Persisted TaskEnvelopeV1 shape for Convex queue/task rows.
 *
 * This validator is the single Convex boundary for the TaskEnvelopeV1 policy
 * snapshot. It is optional on chatroom_messageQueue and chatroom_tasks during
 * the compatibility rollout; canonical semantics and pure forward/backward
 * transforms remain in the shared task-envelope module
 * (@workspace/shared/domain/task-envelope).
 */

import { v } from 'convex/values';

export const taskEnvelopeV1Validator = v.object({
  version: v.literal(1),
  /**
   * @deprecated `code:enhanced` is retired. It stays accepted so historical rows
   * still validate; read paths remap it to `code` (see lib/enhancedModeRetirement.ts).
   * Never write it.
   */
  conversationMode: v.union(
    v.literal('chat'),
    v.literal('code'),
    // @deprecated Retired mode. Kept so historical rows still validate. Read paths remap it to 'code'
    // (see lib/enhancedModeRetirement.ts). Never write it.
    v.literal('code:enhanced')
  ),
  sessionPolicy: v.union(v.literal('continue'), v.literal('new')),
  handoffWorkflow: v.object({
    preset: v.union(v.literal('direct'), v.literal('team')),
    phase: v.union(v.literal('entry'), v.literal('implementation'), v.literal('delivery')),
  }),
});

export type PersistedTaskEnvelopeV1 = typeof taskEnvelopeV1Validator.type;
