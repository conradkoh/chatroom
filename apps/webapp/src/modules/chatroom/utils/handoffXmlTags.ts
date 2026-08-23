/** Handoff report XML tags (structured + legacy). */
export const HANDOFF_REPORT_XML_TAGS = [
  'handoff-overview',
  'handoff-proofs',
  'handoff-direction',
  'handoff-ux',
  'handoff-defragmentation',
  'handoff-notes',
  'handoff-action',
  'handoff-details',
] as const;

/** Legacy enhancer draft-envelope tags retained for historical messages. */
const HANDOFF_ENVELOPE_XML_TAGS = ['user-message', 'additional-context', 'grounding', 'builder-handoff'] as const;

/** Enhancer planning-review-outcome tags (cancelled / failed review messages). */
const HANDOFF_OUTCOME_XML_TAGS = ['planning-review-outcome'] as const;

export const HANDOFF_XML_TAGS = [
  ...HANDOFF_REPORT_XML_TAGS,
  ...HANDOFF_ENVELOPE_XML_TAGS,
  ...HANDOFF_OUTCOME_XML_TAGS,
] as const;
