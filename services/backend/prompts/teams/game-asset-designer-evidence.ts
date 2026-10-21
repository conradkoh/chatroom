/**
 * The game asset designer's evidence-label rule.
 *
 * The four labels and the never-claim sentence are authored here once and used
 * by both the role guidance and the handoff templates so the wording cannot
 * drift between what the designer is told and what it is asked to report.
 */
const GAME_ASSET_EVIDENCE_LABELS = ['measured', 'inspected', 'specified', 'unverified'] as const;

/** Inline list of the labels, e.g. `` `measured`, `inspected`, ... ``. */
export const GAME_ASSET_EVIDENCE_LABEL_LIST = GAME_ASSET_EVIDENCE_LABELS.map(
  (label) => `\`${label}\``
).join(', ');

/**
 * The single claim rule: fidelity is only asserted with measured or inspected
 * evidence, and the wording is identical everywhere it appears.
 */
export const GAME_ASSET_EVIDENCE_RULE =
  'Never claim a polycount, texel density, loudness, color space, or visual-quality result without `measured` or `inspected` evidence.';
