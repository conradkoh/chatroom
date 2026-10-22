/**
 * The game asset designer's evidence-label rules.
 *
 * The four labels and every rule about how they may be used are authored here
 * once and used by both the role guidance and the handoff templates so the
 * wording cannot drift between what the designer is told and what it is asked
 * to report.
 */
const GAME_ASSET_EVIDENCE_LABELS = ['measured', 'inspected', 'specified', 'unverified'] as const;

/** Inline list of the labels, e.g. `` `measured`, `inspected`, ... ``. */
export const GAME_ASSET_EVIDENCE_LABEL_LIST = GAME_ASSET_EVIDENCE_LABELS.map(
  (label) => `\`${label}\``
).join(', ');

/**
 * The claim rule: a result is only asserted with measured or inspected
 * evidence, and the wording is identical everywhere it appears.
 */
export const GAME_ASSET_NEVER_CLAIM_RULE =
  'Never claim a polycount, texel density, loudness, color space, or visual-quality result without `measured` or `inspected` evidence. Numeric results (polycount, texel density, resolution, loudness, true peak, sample rate, bit depth) and color-space slot checks require `measured`; `inspected` covers only visual or audible judgments. A budget or target you write into the spec is a requirement and is labelled `specified`, not a result.';

/** Backwards-compatible alias so existing consumers keep importing one rule. */
export const GAME_ASSET_EVIDENCE_RULE = GAME_ASSET_NEVER_CLAIM_RULE;

/** A checklist item may only be graded pass or fail on checked evidence. */
export const GAME_ASSET_RESULT_RULE =
  'A checklist item is `pass` or `fail` only with `measured` or `inspected` evidence. Otherwise record it as `not checked` and keep its label (`specified` or `unverified`).';

/** What each of the four labels means, authored once for every consumer. */
export const GAME_ASSET_EVIDENCE_DEFINITIONS = `- \`measured\` — a tool or script you ran on the actual file produced the number or read the metadata field; cite the command and its output value (this includes header or JSON values read by command).
- \`inspected\` — you opened the actual file or a render and made a qualitative observation (silhouette, seam, palette, style match); describe what you saw and give no numbers.
- \`specified\` — a target or requirement from the brief or your own spec; no file was checked. A budget you write into a spec is \`specified\`.
- \`unverified\` — a result that should have been checked but could not be (no file access, no tool, unreadable file), or a value someone else stated that you did not check; say why and name the source.`;
