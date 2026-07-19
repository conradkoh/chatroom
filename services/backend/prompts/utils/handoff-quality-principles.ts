/**
 * Quality principles referenced in agent handoff "Proof of Principles" sections.
 * Names and descriptions are SSOT — templates import from here for semantic consistency.
 */

const HANDOFF_QUALITY_PRINCIPLES = [
  {
    name: 'Semantic Consistency',
    description:
      'the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms.',
  },
  {
    name: 'Organization & Maintainability',
    description:
      'a small change in requirements should result in a small change in code in a small number of files and folders.',
  },
  {
    name: 'Reducing Optionality',
    description:
      'code contains the minimum number of code paths to support the functionality required presently.',
  },
  {
    name: 'Static Evaluability and Provability',
    description:
      "the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.",
  },
  {
    name: 'No Revisit',
    description:
      'implemented in a way so the user does not have to revisit this implementation again.',
  },
  {
    name: 'Leave It Better',
    description: 'leave the code in a slightly better state than before when touching files.',
  },
] as const;

/** H2 heading for builder→planner handback */
export const PROOF_OF_PRINCIPLES_HEADING_H2 = '## Proof of Principles';

/** H3 heading for planner→user and solo→user reports */
export const PROOF_OF_PRINCIPLES_HEADING_H3 = '### Proof of Principles';

/**
 * HTML comment block listing principles for handoff template guidance.
 * Matches existing format exactly (bullet list inside <!-- -->).
 */
export function getHandoffQualityPrinciplesCommentBlock(): string {
  const bullets = HANDOFF_QUALITY_PRINCIPLES.map((p) => `- ${p.name}: ${p.description}`).join('\n');
  return `<!-- Demonstrate adherence to:\n${bullets}\n-->`;
}
