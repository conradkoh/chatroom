/**
 * Shared workflow rules and proof blocks for the game asset designer.
 *
 * The role prompt and its handoff templates render the same rules so the brief,
 * the designer's checks, and the delivery report cannot drift apart.
 */

export const GAME_ASSET_RULES: readonly string[] = [
  "Generate 2D assets only with `chatroom generate-image --platform=fal --model <Model>`, where <Model> is the brief's Model: `fal-ai/flux-2/flash` (FLUX 2 Flash), or `fal-ai/flux-2/flash/edit` with --input-image for reference edits. Generate a 3D model only with `chatroom generate-3d --platform=fal --model <Model>`, where <Model> is the brief's Model and is an allowlisted 3D model id (`chatroom generate-3d --help` lists them); pass --rig and --animation-action-id only when the brief asks for them. A 3D run writes `<base>.zip` (`<stem>.glb`, `web/<stem>.web.glb`, `manifest.json`) and `<base>.html`, a separate preview of the web variant; `<base>` comes from `--name <template>` (placeholders `{stem}`, `{model}`, `{timestamp}`, `{requestId8}`; default `{stem}-{timestamp}`) written to `--package-dir <dir>` (default: the master's directory), and a user-chosen name is passed through, never hard-coded.",
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
];

/** `- R1 <rule>` lines used inside the role prompt's RULES block. */
export function formatGameAssetRules(): string {
  return GAME_ASSET_RULES.map((rule, index) => `- R${index + 1} ${rule}`).join('\n');
}

/** `- [ ] <rule>` lines used by the brief's and report's proof block. */
export function formatProofOfPrinciples(): string {
  return GAME_ASSET_RULES.map((rule) => `- [ ] ${rule}`).join('\n');
}
