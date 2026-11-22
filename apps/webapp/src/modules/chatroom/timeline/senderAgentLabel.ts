/** Longest visible length of one chip segment (harness or model) before clipping. */
// fallow-ignore-next-line unused-export
export const SENDER_AGENT_SEGMENT_MAX_LENGTH = 64;

/** Normalized, render-safe sender label. `model` is undefined when the snapshot has none. */
export interface SenderAgentLabel {
  harness: string;
  model: string | undefined;
}

/** trim → collapse whitespace → empty is absent → clip to the max length plus an ellipsis. */
function normalizeSegment(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (collapsed === '') return undefined;
  if (collapsed.length <= SENDER_AGENT_SEGMENT_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, SENDER_AGENT_SEGMENT_MAX_LENGTH)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Returns the label to render for a message, or `undefined` when no chip should render:
 * non-handoff types, a missing or non-object snapshot, or an unusable harness.
 * The model is dropped on its own when unusable; the harness-only label is kept.
 */
export function getSenderAgentLabel(
  type: string,
  senderAgent: unknown
): SenderAgentLabel | undefined {
  if (type !== 'handoff') return undefined;
  if (!isRecord(senderAgent)) return undefined;
  const harnessLabel = normalizeSegment(senderAgent.harness);
  if (harnessLabel === undefined) return undefined;
  return { harness: harnessLabel, model: normalizeSegment(senderAgent.model) };
}

/** Tooltip text for a normalized label: `Harness: X · Model: Y`, or `Harness: X` without a model. */
export function getSenderAgentTitle(label: SenderAgentLabel): string {
  return label.model !== undefined
    ? `Harness: ${label.harness} · Model: ${label.model}`
    : `Harness: ${label.harness}`;
}
