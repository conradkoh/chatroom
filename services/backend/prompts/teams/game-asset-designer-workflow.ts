/**
 * Shared workflow rules and proof blocks for the game asset designer.
 *
 * The role prompt and its handoff templates render the same rules so the brief,
 * the designer's checks, and the delivery report cannot drift apart.
 */

export const GAME_ASSET_RULES: readonly string[] = [
  "Generate 2D assets only with `chatroom generate-image --platform=fal --model <Model>`, where <Model> is the brief's Model: `fal-ai/flux-2/flash` (FLUX 2 Flash), or `fal-ai/flux-2/flash/edit` with --input-image for reference edits. Generate a 3D model only with `chatroom generate-3d --platform=fal --model <Model>`, where <Model> is the brief's Model and is a fal 3D model id (`chatroom generate-3d --help` lists the known ids and their flags); the default is `fal-ai/trellis-2`, where a prompt generates a reference image first and that image ships in the zip. Pass --rig and --animation-action-id only for `meshy/v7.1` models, only when the brief asks for them, and only after the user confirms the priced dry run (a real run needs --confirm-cost). Pass --confirm-cost only when ## Cost confirmation quotes the user's approval; otherwise run --dry-run, return the priced plan, and do not pass --confirm-cost. A 3D run writes `<base>.zip` (`<stem>.glb`, `web/<stem>.web.glb`, `manifest.json`, the reference image when one was generated or supplied, and the rigged and animation GLBs with their web versions when rigging ran) and `<base>.html`, a separate preview of the web variant; `<base>` is the `--out` stem plus the run's UTC timestamp, and `--package-dir <dir>` (default: the master's directory) moves both.",
  'Process images only with `chatroom slice-image` and `chatroom remove-image-background`; no other tool, script, or remote service.',
  "A sheet is at most the brief's `Sheet grid` (default 2x2); a larger grid needs a user request quoted in the brief.",
  'Names come from looking at each tile, never from cell order or prompt order.',
  "Never pass `--names` to `slice-image` except P8's fallback when `remove-image-background --help` fails; assign names only with `remove-image-background --map` or `--out`.",
  'Write only under `Output location` and `Allowed edit paths`; never overwrite or delete unless the brief names the path.',
  'Mark `pass` or `fail` only with `measured` or `inspected` evidence (labels below).',
  'Run `<command> --help` before first use of `slice-image`, `remove-image-background`, or `generate-3d`.',
  'Always pass `--trim` to `chatroom remove-image-background`; use `--trim-padding` only when the brief names a padding.',
  'If `generate-image` or `generate-3d` is missing, `FAL_API_KEY` is not set, or the generator fails, stop generation, deliver `spec only`, quote the exact error in Summary, and list it under Open questions. Do not retry in a loop.',
  'Do not install or run any remote tool, script, or skill, and do not fetch generator code.',
  'Never switch generators.',
  'Describe generated output as production-ready only when every checklist item for it passes with `measured` or `inspected` evidence.',
  'Commit only when the brief names the paths and the commit message.',
  'Generate only when the brief names an output location and allowed tools.',
  'Before the first real call of each command shape (sheet, per-asset, reference edit, or 3D model), run the same command with --dry-run and apply every constraint it prints; take model-specific constraints only from the dry run, never from memory.',
  "You own the lighting and palette anchor for the asset set: from the brief's `## Lighting contract` and `## Style reference`, define one shared anchor (palette, light direction, colour temperature, background, material treatment) and repeat it word for word in every prompt of the set. Write every prompt yourself; the brief states goals and constraints, not prompts.",
  'Honour the `## Lighting contract`: when it says no environment map, ship no whole-surface metal (set `metallicFactor` explicitly, never rely on the glTF default of 1.0) and no baked lighting; resolve every material warning `generate-3d` prints, or report it under Open questions.',
  "Verify lighting under the target conditions, not the generator's: inspect each 3D asset in the `generate-3d` preview's Directional and Unlit modes (no environment map) and record what you saw; Studio mode is image-based lighting and is never lighting evidence. A render under the project's real rig is evidence only when it exists and is attached by path. Mark the lighting checklist item `not checked` when no such render exists; `not checked` on lighting blocks delivery (the Summary starts `Blocked: lighting not verified`).",
];

/** `- R1 <rule>` lines used inside the role prompt's RULES block. */
export function formatGameAssetRules(): string {
  return GAME_ASSET_RULES.map((rule, index) => `- R${index + 1} ${rule}`).join('\n');
}

/** `- [ ] <rule>` lines used by the brief's and report's proof block. */
export function formatProofOfPrinciples(): string {
  return GAME_ASSET_RULES.map((rule) => `- [ ] ${rule}`).join('\n');
}
