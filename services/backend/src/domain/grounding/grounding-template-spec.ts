/**
 * Grounding Template Spec
 *
 * Single source of truth for the `type: 'grounding'` markdown contract: the
 * section names, their fixed order, length limit and error codes. Pure module
 * (no imports) so the CLI template generator and the backend validator can both
 * read it.
 *
 * A grounding is a neutral, factual observation record published before
 * delegating discovery work. It has no conclusion, risk or recommendation
 * section.
 */

/** Maximum stored grounding length in characters (validator rejects longer with GROUNDING_TOO_LONG). */
export const GROUNDING_MAX_CHARS = 20_000;

/** Literal a section may contain instead of content, where allowed. */
export const GROUNDING_NONE_TOKEN = 'None observed.';

export const GROUNDING_TITLE_PREFIX = 'Grounding: ';

export const GROUNDING_HEADINGS = { title: '# ', section: '## ' } as const;

/** Human-readable section names. The keys are the internal section ids. */
export const GROUNDING_SECTION_NAMES = {
  request: 'Request',
  relevantFiles: 'Relevant files',
  entryPoints: 'Entry points',
  flow: 'Flow',
  priorRecords: 'Prior records',
  notInspected: 'Not inspected',
} as const;

export type GroundingSectionName = keyof typeof GROUNDING_SECTION_NAMES;

/** Canonical, fixed order. Every section is required. */
export const GROUNDING_SECTION_ORDER: readonly GroundingSectionName[] = [
  'request',
  'relevantFiles',
  'entryPoints',
  'flow',
  'priorRecords',
  'notInspected',
];

/** Sections that may be exactly `None observed.`. `request` and `relevantFiles` must have content. */
export const GROUNDING_NONE_ALLOWED_SECTIONS: readonly GroundingSectionName[] = [
  'entryPoints',
  'flow',
  'priorRecords',
  'notInspected',
];

export type GroundingErrorCode =
  | 'GROUNDING_TOO_LONG'
  | 'GROUNDING_TITLE_MISSING'
  | 'GROUNDING_SECTION_MISSING'
  | 'GROUNDING_SECTION_ORDER'
  | 'GROUNDING_SECTION_EMPTY'
  | 'GROUNDING_FENCE_UNCLOSED';

/** The exact `## ` heading line for a section, e.g. `## Relevant files`. */
export function groundingSectionHeading(name: GroundingSectionName): string {
  return `${GROUNDING_HEADINGS.section}${GROUNDING_SECTION_NAMES[name]}`;
}
