/** Handoff report XML tags (structured + legacy). */
export const HANDOFF_REPORT_XML_TAGS = [
  'handoff-overview',
  'handoff-proofs',
  'handoff-direction',
  'handoff-ux',
  'handoff-notes',
  'handoff-action',
  'handoff-details',
] as const;

/** Enhancer check-in envelope tags. */
export const HANDOFF_ENVELOPE_XML_TAGS = ['user-message', 'grounding', 'builder-handoff'] as const;

export const HANDOFF_XML_TAGS = [...HANDOFF_REPORT_XML_TAGS, ...HANDOFF_ENVELOPE_XML_TAGS] as const;

export type HandoffXmlTag = (typeof HANDOFF_XML_TAGS)[number];
