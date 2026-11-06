/**
 * Persisted TaskEnvelopeV1 shape for Convex queue/task rows.
 *
 * This validator is the single Convex boundary for the TaskEnvelopeV1 policy
 * snapshot. It is optional on chatroom_messageQueue and chatroom_tasks during
 * the compatibility rollout; canonical semantics and pure forward/backward
 * transforms remain in the shared task-envelope module
 * (@workspace/shared/domain/task-envelope).
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import { v } from 'convex/values';

import { retireEnhancedScalarMode, retireEnhancedTaskEnvelope } from './enhancedModeRetirement';

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
    preset: v.union(
      v.literal('direct'),
      v.literal('team'),
      // @deprecated Retired preset. Kept so historical rows validate; reads remap it to 'team'. Never write it.
      v.literal('enhanced-team')
    ),
    phase: v.union(
      v.literal('entry'),
      // @deprecated Retired phase. Kept so historical rows validate; reads remap it to 'implementation'. Never write it.
      v.literal('enhancement'),
      v.literal('implementation'),
      v.literal('delivery')
    ),
  }),
});

export type PersistedTaskEnvelopeV1 = typeof taskEnvelopeV1Validator.type;

/** The policy fields a persisted task/queue row carries. */
export interface PersistedTaskPolicyFields {
  readonly taskEnvelope?: unknown;
  readonly conversationMode?: unknown;
  readonly startInNewSession?: boolean | undefined;
}

/** Narrows a stored scalar mode, remapping the retired `code:enhanced` value. */
function toConversationModeInput(mode: unknown): ConversationMode | undefined {
  if (mode === 'chat' || mode === 'code') return mode;
  return retireEnhancedScalarMode(mode) ?? undefined;
}

/**
 * Normalizes a persisted row's envelope for readers, remapping the retired
 * `code:enhanced` mode and the retired workflow preset/phase first.
 *
 * The Convex validator still accepts those literals so historical rows validate.
 * Read paths must normalize through this helper so the retired values never
 * surface as policy.
 */
export function normalizePersistedTaskEnvelope(row: PersistedTaskPolicyFields): TaskEnvelopeV1 {
  return normalizeTaskEnvelope({
    taskEnvelope: retireEnhancedTaskEnvelope(row.taskEnvelope) ?? row.taskEnvelope,
    conversationMode: toConversationModeInput(row.conversationMode),
    startInNewSession: row.startInNewSession,
  });
}
