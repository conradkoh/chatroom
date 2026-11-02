/**
 * Shared, domain-neutral rules and proof blocks for the game asset designer.
 *
 * The role prompt, its handoff templates, and the AI generation skills render
 * this same generic block so the brief, the designer's checks, and the delivery
 * report cannot drift apart. Domain-specific rules (generator commands, flags,
 * package contents, sheet and tile steps, and the 3D/2D checklists) live in the
 * matching skill so this block stays true for every asset type.
 */

export const GAME_ASSET_RULES: readonly string[] = [
  'Write only under `Output location` and `Allowed edit paths`; never overwrite or delete unless the brief names the path.',
  'Mark `pass` or `fail` only with `measured` or `inspected` evidence (labels below).',
  'If the generator is missing, `FAL_API_KEY` is not set, or generation fails, stop generation, deliver `spec only`, quote the exact error in Summary, and list it under Open questions. Do not retry in a loop.',
  'Do not install or run any remote tool, script, or skill, and do not fetch generator code.',
  'Never switch generators.',
  'Describe generated output as production-ready only when every checklist item for it passes with `measured` or `inspected` evidence.',
  'Commit only when the brief names the paths and the commit message.',
  'Generate only when the brief names an output location and allowed tools.',
  "You own the lighting and palette anchor for the asset set: from the brief's `## Lighting contract` and `## Style reference`, define one shared anchor (palette, light direction, colour temperature, background, material treatment) and repeat it word for word in every prompt of the set. Write every prompt yourself; the brief states goals and constraints, not prompts.",
  'Honour the `## Lighting contract`: no lighting may be baked into the base colour, and every material warning the generator reports that remains after one regeneration is listed under Open questions. The **rig reference render** is "the existing render of the target rig, attached by path under `## Lighting contract`, used as a style target before generation. It is input only and cannot support `pass`."',
  'Verify lighting under the target conditions, not the generator\'s. A `pass` also needs an **asset-in-rig render**: "a render of the generated asset loaded in the project\'s real scene after generation, attached by path under `## Lighting verification`. Only this render supports `pass`." Producing it is never your job. Without it the lighting checklist item is `not checked`, which blocks delivery (the Summary starts `Delivered, lighting not verified:`).',
];

/** `- R1 <rule>` lines used inside the role prompt's RULES block. */
export function formatGameAssetRules(): string {
  return GAME_ASSET_RULES.map((rule, index) => `- R${index + 1} ${rule}`).join('\n');
}

/** `- [ ] <rule>` lines used by the brief's and report's proof block. */
export function formatProofOfPrinciples(): string {
  return GAME_ASSET_RULES.map((rule) => `- [ ] ${rule}`).join('\n');
}
