import {
  GAME_ASSET_EVIDENCE_DEFINITIONS,
  GAME_ASSET_EVIDENCE_LABEL_LIST,
  GAME_ASSET_NEVER_CLAIM_RULE,
  GAME_ASSET_RESULT_RULE,
} from './game-asset-designer-evidence';
import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for a planner delegating game asset work to the game asset designer. */
export function getEntryPointToGameAssetDesignerHandoffTemplate(
  query: HandoffTemplateQuery
): string {
  const entryPoint = query.fromRole;

  return `Instructions (not part of the message): Pass the asset request as a brief the designer can act on without guessing. Provide every field below; write \`Not specified.\` for a field you cannot fill and the designer will ask or apply a stated default. Give each asset a stable ID (\`A01\`, \`A02\`…). Use \`spec only\` only when you want a specification with no files; the default is \`spec and generate\`.

## Asset request
<one to three sentences: what the assets are for and the user-visible goal>

## Target
<engine and version; genre and camera; platform tier (mobile, PC, console, VR); render pipeline if known>

## Assets requested
<numbered list with stable IDs \`A01\`, \`A02\`…; each item: asset name, category (3D model, PBR textures, 2D sprite/UI, audio, other), purpose, quantity or variants>

## Budgets and conventions
<triangle budget per LOD, texel density or pixel grid, texture resolution and atlas limits, loudness target, naming convention, folder layout; or \`Not specified.\`>

## Style reference
<repository paths, URLs, or a written style sheet; or \`Not specified.\`>

## Spec consumer
<who produces or integrates these assets from the spec: \`builder\`, \`uiux-engineer\`, an external artist, or \`user\`>

## Existing assets
<repository paths the designer must reuse or must not overwrite; or \`Not specified.\`>

## Deliverable mode
<\`spec and generate\` (default when you name an output location and allowed tools) or \`spec only\`>

## Allowed tools
<the generators the designer may run, or \`Any tool available in the designer's shell.\`; say which>

## Allowed edit paths
<repository-relative paths the designer may edit; \`None.\` for none>

## Commit
<\`None.\` or the commit message and the paths to commit>

## Output location
<the exact repository directory the designer may write to; required for \`spec and generate\`; \`None.\` for \`spec only\`>

## Acceptance criteria
<what must be true for the planner to accept the delivery>

Instructions after the body (not part of the message): run the normal handoff command to \`game-asset-designer\` with the complete body above, then stop. Use this template only under the conditions below; the body above ends at \`## Acceptance criteria\`.

### When to use the game asset designer
- the request creates or changes game art or audio assets (models, textures, sprites, UI art, sound effects);
- assets must meet engine import conventions or budgets before a builder integrates them;
- the user asks for an asset spec, style sheet, or asset audit.

Skip it for code-only work, for a trivial asset rename, and for non-game UI icons or illustrations (use \`uiux-engineer\`).

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'game-asset-designer',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for the game asset designer returning its delivery report to the entry role. */
export function getGameAssetDesignerToEntryPointHandoffTemplate(
  query: HandoffTemplateQuery
): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return a complete asset delivery report for the request the planner named. State only what you established. Label every checked property with one evidence label: ${GAME_ASSET_EVIDENCE_LABEL_LIST}. Definitions: ${GAME_ASSET_EVIDENCE_DEFINITIONS} ${GAME_ASSET_NEVER_CLAIM_RULE} ${GAME_ASSET_RESULT_RULE} Write only under the named output location and the named edit paths. In \`spec only\` you write no files. Use the exact sections below, in this order. If you are blocked or need a clarification, send the same sections with Summary starting \`Blocked:\` and every section you could not reach written as \`Not started.\`

## Summary
<one to three sentences: what was delivered, whether it is spec only or includes files, and the count of \`fail\` and \`not checked\` items>

## Target and assumptions
<each assumption you made and why; each deviation from the planner's target or budgets; or \`None.\`>

## Asset manifest
<one entry per asset, keyed by the planner's stable ID (\`A01\`…): name, category, file format, path (or \`Specified only.\`), dimensions/units/scale, pivot, naming, LOD list with triangle budgets, texture set with resolution, color space and channel packing, atlas/pixel grid/frame data, audio format and loudness target, import settings, dependencies and variants; for each budget, the acceptance check (exact command and expected value); for each generated file, the generator (tool + version + command or seed)>

## Quality checklist results
<per asset: each applicable checklist item as \`pass\`, \`fail\`, \`n/a\`, or \`not checked\`, with its evidence label and, for \`measured\`, the command and value; write exactly \`None failed.\` after the list if no item failed>

## Acceptance criteria results
<each planner acceptance criterion as \`met\`, \`not met\`, or \`not checked\`, with its evidence label>

## Style consistency
<how the set matches the style reference; deviations; what was compared and how>

## Created and edited paths
<repository-relative paths and a one-line description each; write exactly \`None.\` for spec only>

## Commits
<write exactly \`None.\` if none; otherwise one line per commit: \`<sha> <message>\`>

## Sources
<URLs for engine or platform rules relied on, with version or date checked>

## Open questions
<each clarification needed from the planner with a recommended default; write exactly \`None.\` if none>

## Not verified
<every property you could not measure or inspect; write exactly \`None.\` if none>

## Recommended next step
<exactly one target: \`game-asset-designer\` (re-run with the listed asset IDs), \`builder\` (integrate, or apply the listed import settings), \`uiux-engineer\` (place the listed UI art in a screen design), or \`planner\` (decision needed on an open question); then the affected asset IDs>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'game-asset-designer',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
