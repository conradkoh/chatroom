/**
 * Skeleton generator for the grounding markdown contract.
 *
 * Single source of truth for the `chatroom grounding view-template` output: the
 * section names, their order, the title prefix and the limits all come from
 * `grounding-template-spec.ts`, so the printed skeleton cannot drift from
 * `validateGrounding`.
 */

import {
  GROUNDING_HEADINGS,
  GROUNDING_MAX_CHARS,
  GROUNDING_NONE_TOKEN,
  GROUNDING_SECTION_NAMES,
  GROUNDING_SECTION_ORDER,
  GROUNDING_TITLE_PREFIX,
  groundingSectionHeading,
  type GroundingSectionName,
} from '../../../src/domain/grounding/grounding-template-spec';

const FENCE = '```';

/** Placeholder body lines for each section, in the spec's section names. */
const SECTION_BODY: Record<GroundingSectionName, readonly string[]> = {
  request: ['- <what was asked, restated without interpretation> (source: <message id>)'],
  relevantFiles: ['- `<repo-relative path>` — <what the file contains or defines, as observed>'],
  entryPoints: [
    '- `<symbol, route, command or function>` in `<path>` — <how it is reached, as observed>',
  ],
  flow: [
    FENCE + 'mermaid',
    'sequenceDiagram',
    '  <A>->><B>: <observed call or data hand-off>',
    FENCE,
  ],
  priorRecords: ['- `<decision-record or documentation path>` — <what it states>'],
  notInspected: ['- <area, file or question not examined or not determinable>'],
};

/** The fill-in skeleton. Built from the spec: section names and order come from the spec, never from literals. */
export function getGroundingSkeleton(): string {
  const lines = [`${GROUNDING_HEADINGS.title}${GROUNDING_TITLE_PREFIX}<topic of the request>`];
  for (const name of GROUNDING_SECTION_ORDER) {
    lines.push('', groundingSectionHeading(name), ...SECTION_BODY[name]);
  }
  return lines.join('\n');
}

/** Rules printed after the skeleton. Built from the same constants. */
export function getGroundingRules(): string {
  return [
    'Rules for this document:',
    '- Record only what you observed in the repository or in chatroom messages. Cite a path (and a line when known) for each fact.',
    '- Do not recommend, choose, rank, diagnose or conclude. Do not name a cause or a solution.',
    '- State uncertainty under `Not inspected`, not in the other sections.',
    `- Maximum ${GROUNDING_MAX_CHARS} characters.`,
    `- The sections ${GROUNDING_SECTION_NAMES.entryPoints}, ${GROUNDING_SECTION_NAMES.flow}, ${GROUNDING_SECTION_NAMES.priorRecords} and ${GROUNDING_SECTION_NAMES.notInspected} may be \`- ${GROUNDING_NONE_TOKEN}\` when nothing applies. ${GROUNDING_SECTION_NAMES.request} and ${GROUNDING_SECTION_NAMES.relevantFiles} must have content.`,
    '- Keep every section, in this order. It is immutable: publish a new one if your observations change.',
  ].join('\n');
}
