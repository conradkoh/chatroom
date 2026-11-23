/**
 * Plan Template Spec
 *
 * The single source of truth for the `type: 'plan'` message markdown contract:
 * headings, limits, tokens, section order and the parser error-code union.
 *
 * Every consumer (the parser, the CLI renderer, future prompts) imports these
 * constants instead of re-declaring string literals, so the template can only
 * change in one place.
 *
 * Constraints:
 * - Pure module: no imports, no side effects, no Convex types.
 * - Section order is fixed; `Remarks` is last.
 * - A plan's markdown is the only stored truth (`ParsedPlan` is a derived read
 *   contract), so these names must stay stable for already-published plans.
 */

/** Maximum plan length in characters; longer plans are rejected at write time. */
export const PLAN_MAX_CHARS = 40_000;
/** Maximum number of phases a plan may declare. */
export const PLAN_MAX_PHASES = 20;
/** Token that stands in for an intentionally empty list. */
export const PLAN_NONE_TOKEN = 'None.';
/** Phase id format: P1, P2, … (1-based, no leading zeros). */
export const PLAN_PHASE_ID_PATTERN = /^P([1-9]\d*)$/;
/** Separator between a phase id and its title in lists and headings. */
export const PLAN_PHASE_SEPARATOR = '—';
/** Markdown heading prefixes used by the plan template. */
export const PLAN_HEADINGS = {
  title: '# ',
  section: '## ',
  phase: '### ',
  phaseSection: '#### ',
} as const;

export const PLAN_SECTION_NAMES = {
  sources: 'Sources',
  requirements: 'Requirements',
  constraints: 'Constraints',
  phases: 'Phases',
  phaseDetails: 'Phase details',
  remarks: 'Remarks',
} as const;
export type PlanSectionName = keyof typeof PLAN_SECTION_NAMES;

/** Canonical order; Remarks is last. */
export const PLAN_SECTION_ORDER: readonly PlanSectionName[] = [
  'sources',
  'requirements',
  'constraints',
  'phases',
  'phaseDetails',
  'remarks',
];
export const PLAN_REQUIRED_SECTIONS: readonly PlanSectionName[] = [
  'sources',
  'requirements',
  'constraints',
  'phases',
  'phaseDetails',
];
/** Plan-level sections where `None.` may stand in for an empty list. */
export const PLAN_NONE_ALLOWED_SECTIONS: readonly PlanSectionName[] = ['sources', 'constraints'];

export const PLAN_PHASE_SECTION_NAMES = {
  dependsOn: 'Depends on',
  requirements: 'Requirements',
  constraints: 'Constraints',
  acceptance: 'Acceptance criteria',
} as const;
export type PlanPhaseSectionName = keyof typeof PLAN_PHASE_SECTION_NAMES;
export const PLAN_PHASE_SECTION_ORDER: readonly PlanPhaseSectionName[] = [
  'dependsOn',
  'requirements',
  'constraints',
  'acceptance',
];
export const PLAN_REQUIRED_PHASE_SECTIONS: readonly PlanPhaseSectionName[] = [
  'requirements',
  'constraints',
  'acceptance',
];
/**
 * Per-phase sections where `None.` may stand in for an empty list.
 * `Constraints` is included to match the plan template, which allows
 * `- None.` for both plan-level and per-phase constraints.
 */
export const PLAN_NONE_ALLOWED_PHASE_SECTIONS: readonly PlanPhaseSectionName[] = [
  'dependsOn',
  'constraints',
];

export type PlanParseErrorCode =
  | 'PLAN_TITLE_MISSING'
  | 'PLAN_SECTION_MISSING'
  | 'PLAN_SECTION_ORDER'
  | 'PLAN_SECTION_EMPTY'
  | 'PLAN_PHASE_LIST_EMPTY'
  | 'PLAN_PHASE_ID_INVALID'
  | 'PLAN_PHASE_DETAIL_MISSING'
  | 'PLAN_PHASE_DETAIL_UNLISTED'
  | 'PLAN_PHASE_TITLE_MISMATCH'
  | 'PLAN_PHASE_SECTION_MISSING'
  | 'PLAN_DEPENDS_ON_INVALID'
  | 'PLAN_TOO_LONG'
  | 'PLAN_TOO_MANY_PHASES';
