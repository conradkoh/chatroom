/**
 * Shared workflow rules and proof blocks for the game asset designer.
 *
 * The role prompt and its handoff templates render the same rules so the brief,
 * the designer's checks, and the delivery report cannot drift apart.
 */

// fallow-ignore-next-line unused-export
export const GAME_ASSET_DEFAULT_SHEET_GRID = '2x2';
// fallow-ignore-next-line unused-export
export const GAME_ASSET_DEFAULT_IMAGE_MODEL_RULE =
  'generate only with chatroom generate-image --platform=fal; use the CLI default model unless the brief names one';

// fallow-ignore-next-line unused-export
export const GAME_ASSET_RULES: readonly string[] = [
  'Generate only with `chatroom generate-image --platform=fal`, using the CLI default model unless the brief names one.',
  'Process images only with `chatroom slice-image` and `chatroom remove-image-background`; no other tool, script, or remote service.',
  "A sheet is at most the brief's `Sheet grid` (default 2x2); a larger grid needs a user request quoted in the brief.",
  'Names come from looking at each tile, never from cell order or prompt order.',
  'Never pass `--names` to `slice-image`; assign names only with `remove-image-background --map` or `--out`.',
  'Write only under `Output location` and `Allowed edit paths`; never overwrite or delete unless the brief names the path.',
  'Mark `pass` or `fail` only with `measured` or `inspected` evidence (labels below).',
  'Run `<command> --help` before first use of `slice-image` or `remove-image-background`.',
  'Always pass `--trim` to `chatroom remove-image-background`; use `--trim-padding` only when the brief names a padding.',
  'Positioned sheets use exact layout JSON for the model that supports it (currently `fal-ai/moss-image`): the layout goes in `--prompt`, and `image_size` must equal the canvas the coordinates use. Bboxes are `[y_min,x_min,y_max,x_max]` in pixels from the canvas centre, y down, x right. `enable_prompt_expansion` is false for positioned layouts. Use `--output-format png`. Never pass `--aspect-ratio` to moss. Do not add model-specific values that the brief does not name.',
];

export const GAME_ASSET_PROOF_OF_PRINCIPLES: readonly string[] = GAME_ASSET_RULES.map(
  (rule) => rule
);

/** `- R1 <rule>` lines used inside the role prompt's RULES block. */
export function formatGameAssetRules(): string {
  return GAME_ASSET_RULES.map((rule, index) => `- R${index + 1} ${rule}`).join('\n');
}

/** `- [ ] <rule>` lines used by the brief's and report's proof block. */
export function formatProofOfPrinciples(): string {
  return GAME_ASSET_PROOF_OF_PRINCIPLES.map((rule) => `- [ ] ${rule}`).join('\n');
}
