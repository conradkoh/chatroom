/**
 * Sender Agent entity: the harness + model of the agent that sent a handoff,
 * captured as a point-in-time snapshot when the handoff is written.
 *
 * Informational metadata only. Its caller trust matches `senderRole`: the backend
 * validates the shape but never authorizes on it. Normalization never fails a
 * handoff; an unknown harness or an unusable model is dropped.
 *
 * @see docs/conventions/domain-models.md
 */

// The length cap is exercised by the co-located test; the dead-code scan does not
// count that test as a consumer, so suppress the false positive.
// fallow-ignore-file unused-export

import { v } from 'convex/values';

import { agentHarnessValidator, isAgentHarness, type AgentHarness } from './agent';

/** Longest model identifier stored on a sender snapshot (characters, after trimming). */
export const SENDER_AGENT_MODEL_MAX_LENGTH = 200;

/** Stored shape on `chatroom_messages.senderAgent`. Strict: harness must be a known harness. */
export const senderAgentValidator = v.object({
  harness: agentHarnessValidator,
  model: v.optional(v.string()),
});

/** Lenient wire shape accepted by `messages.handoff`. Normalized before storage. */
export const senderAgentInputValidator = v.object({
  harness: v.string(),
  model: v.optional(v.string()),
});

export type SenderAgentInput = { harness: string; model?: string | undefined };

export interface SenderAgent {
  harness: AgentHarness;
  model?: string;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Returns the trimmed model when it is storable, otherwise `undefined`. */
function normalizeModel(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > SENDER_AGENT_MODEL_MAX_LENGTH) return undefined;
  if (hasControlCharacter(trimmed)) return undefined;
  return trimmed;
}

/**
 * Returns the storable snapshot, or `undefined` when there is no usable harness.
 * Never throws. A bad model drops only the model: the harness-only snapshot is kept.
 */
export function normalizeSenderAgent(input: SenderAgentInput | undefined): SenderAgent | undefined {
  if (!input || !isAgentHarness(input.harness)) return undefined;
  const model = normalizeModel(input.model);
  return model ? { harness: input.harness, model } : { harness: input.harness };
}
