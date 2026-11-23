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

import { v } from 'convex/values';

import { agentHarnessValidator, isAgentHarness, type AgentHarness } from './agent';

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

/** Longest model identifier stored on a sender snapshot (characters, after trimming and whitespace collapse). */
// Test-only consumer: the co-located entity test asserts the cap, and the dead-code scan does not count tests.
// fallow-ignore-next-line unused-export
export const SENDER_AGENT_MODEL_MAX_LENGTH = 200;

/**
 * Characters a stored model may never contain:
 * - any Unicode control character (`\p{Cc}`: C0 incl. tab and newline, DEL, C1 incl. U+0085)
 * - the line and paragraph separators U+2028 and U+2029
 * - `|`, the delimiter of the linear download header (`| harness=<h> model=<m>`)
 */
const UNSAFE_MODEL_CHARACTER = /[\p{Cc}\u2028\u2029|]/u;

/**
 * Returns the storable model (trimmed, internal whitespace runs collapsed to one space),
 * otherwise `undefined`.
 */
function normalizeModel(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  if (UNSAFE_MODEL_CHARACTER.test(trimmed)) return undefined;
  const collapsed = trimmed.replace(/\s+/g, ' ');
  if (collapsed.length > SENDER_AGENT_MODEL_MAX_LENGTH) return undefined;
  return collapsed;
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
