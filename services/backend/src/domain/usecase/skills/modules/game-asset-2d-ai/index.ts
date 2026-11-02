import type { SkillModule } from '../../registry';

export const gameAsset2dAiSkill: SkillModule = {
  skillId: 'game-asset-2d-ai',
  name: '2D Game Asset Design (AI Generation)',
  description:
    'Use when a task needs 2D sprite or UI art generated with `chatroom generate-image --platform=fal`, including sheets, slicing, background removal, and per-asset fallbacks. (game-asset-designer only)',
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "game-asset-2d-ai" skill.

# 2D Game Asset Design — AI Generation

Activate this skill when the asset is 2D sprite or UI art produced by \`chatroom generate-image --platform=fal\`, whether one image at a time or a sheet that is sliced into tiles. The brief is the contract: it names the model, the sheet grid, the perspective, the output paths, the allowed tools, and the lighting contract.

The shared rules in your role prompt apply, including its evidence labels; this skill adds only the 2D procedure and checklist below.

## Procedure

1. Recover the brief. Do not generate unless \`## Output location\`, \`## Allowed tools\`, \`## Model\`, and \`## Perspective\` are present. If the perspective is \`Not specified.\`, pick one, record it under assumptions, and use it for the whole set.
2. Count the assets (N). If N is 1 or the styles differ, use the per-asset path (step 4). Otherwise use \`ceil(N/(C×R))\` sheets at most the brief's \`## Sheet grid\` (default 2x2); a larger grid needs a user request quoted in the brief, one asset per cell, \`CxR\` cells, no borders and no duplicates.
3. Dry run each command shape (sheet, per-asset, and reference edit) before its first real call: \`chatroom generate-image --platform=fal --model <Model> --prompt "<prompt>" --out <out> --input '<JSON>' --dry-run\`. Apply every constraint it prints; never add a parameter the dry run reports as unsupported. Then generate with the same shape, adding \`--seed <n>\`. Use \`fal-ai/flux-2/flash/edit\` with \`--input-image <path>\` only when the brief names that model and \`## Perspective\` names a reference path; in edit mode generate every asset individually and never use a sheet.
4. Per-asset path, one call per asset: \`chatroom generate-image --platform=fal --model <Model> --prompt "<prompt>" --out <Output location>/_work/<ascii-name>.png --seed <n> --input '<JSON>'\`.
5. Run \`chatroom slice-image --help\` before the first use, then \`chatroom slice-image --in <sheet> --out-dir <Output location>/_work/tiles --cols C --rows R\`. If the sheet is refused, regenerate it once; if it is still refused, fall back to one \`generate-image\` call per asset (step 4).
6. Inspect every tile. A valid tile holds exactly one complete asset: zero or two or more items, a cut item, or a count that differs from the brief's requested count (extra empty cells are fine) fails the tile check. Regenerate the sheet once; if a tile still fails, fall back to one \`generate-image\` call for that asset (step 4). Assign names from what you see, never from cell order or prompt order.
7. Run \`chatroom remove-image-background --help\`. When it succeeds, isolate with \`remove-image-background --in-dir <tiles> --out-dir <Output location> --map <stem>=<name>,... --trim\` for a sheet, or \`remove-image-background --in <image> --out <Output location>/<name>.png --trim\` for one asset, then view the results. If it warns or leaves a halo, rerun with \`--tolerance\`/\`--force\` at most twice, then accept. If \`--help\` fails, rerun \`slice-image --names\` and record trimming not delivered as a failed item/open question.
8. Record the model id, seed, sheet and tile manifests, and each isolated asset name and path.

## Perspective consistency (generated 2D sets)

Assets used together must share one camera perspective. The model's constraints (unsupported parameters, size defaults, what it does not guarantee) come only from the matching \`--dry-run\`; apply them, and never add a parameter the dry run reports as unsupported.

- Repeat the perspective term from the brief's \`## Perspective\` word for word in every prompt of the set (never the \`reference:\` path), and add the same flattening terms to every prompt: \`flat 2D game asset, orthographic, centered, plain background, even lighting\`. Suggested perspective terms (\`unverified\`): side view, front view, orthographic top-down, orthographic isometric, dimetric 2:1, three-quarter view. If the field names only a reference, describe that reference's view in words and record the description under assumptions. If \`## Perspective\` is \`Not specified.\`, pick one, record it under assumptions, and use it for the whole set. If the \`## Style reference\` asks for a lighting style these terms contradict (for example dramatic lighting), keep the perspective term and drop only the conflicting flattening term.
- Use one \`--input\` JSON on every call of the set; if the dry run reports a size parameter as defaulted, set it once in that JSON and reuse it.
- Use one shared \`--seed\` for the first call of each item or sheet. For every regeneration (a refused or failed sheet, a failed tile, or a perspective mismatch), use a new seed and record it. A shared seed does not keep perspective across different prompts.
- Inspect the set side by side. A mismatched item is regenerated individually with a new seed, at most twice per item, separately from sheet regenerations. If it still differs, mark the perspective checklist item \`fail\` with \`inspected\` evidence.

## Lighting and palette anchor

- You own the anchor: from the brief's \`## Lighting contract\` and \`## Style reference\`, choose one lighting and palette anchor (palette, light direction, colour temperature, background, material treatment) for the whole set.
- Repeat the same lighting, palette, and background terms word for word in every prompt of the set; they extend the perspective terms above.
- Generating a separate, unrelated reference image per asset is how colour and lighting drift; generate the first approved asset's reference and reuse its palette and lighting words for the rest.
- The planner's brief gives goals and constraints; you write the prompts.
- If the \`## Lighting contract\` and the \`## Style reference\` conflict, follow the contract and record the deviation under assumptions.

## Quality checklist — 2D sprites and UI art

Mark each applicable item \`pass\`, \`fail\`, or \`n/a\` with its evidence label.

- Fixed grid and pixels-per-unit declared; sprite sizes are multiples of the grid; no sub-pixel offsets.
- Palette size and colors declared; transparent background with clean alpha edges.
- Animation: uniform frame size per clip, frame count, frame rate, loop flag, and pivot per clip.
- Atlas: padding of at least the engine default (Unity default 4 px), atlas size within the platform max, filter mode Point for pixel art, and no mip maps.
- Export PNG (lossless with alpha); the name states size and frame count where relevant.
- Camera perspective matches the perspective chosen for the set (the brief's \`Perspective\`, or the one recorded under assumptions) and every other asset in the set (compare them side by side); \`n/a\` for a single asset.
- Naming follows the project convention (type prefix, descriptive name, variant); ASCII, no spaces; the folder matches the asset category.
- The file format is the one the target engine imports; no unused data.
- Style matches the named style reference: silhouette, value range, palette, level of detail, and pixel grid.
- Budgets in the request are met; any exceedance is called out with the measured value.

## Domain rules

- Always pass \`--trim\` to \`chatroom remove-image-background\`; use \`--trim-padding\` only when the brief names a padding.
- Process images only with \`chatroom slice-image\` and \`chatroom remove-image-background\`; no other tool, script, or remote service.
- Never pass \`--names\` to \`slice-image\` except for the fallback above; assign names only with \`remove-image-background --map\` or \`--out\`.

## Proof of Principles

Append these lines to the report's Proof of Principles when this skill is used:

- \`--trim\` on every \`remove-image-background\` call; \`--trim-padding\` only when the brief names a padding.
- A sheet is at most the brief's \`## Sheet grid\` (default 2x2); a larger grid needs a user request quoted in the brief.
- \`--names\` only in the \`remove-image-background --help\` fallback; names otherwise come from \`--map\` or \`--out\`.
- A dry run of each command shape before its first real call.
`,
};
