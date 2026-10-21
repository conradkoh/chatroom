import {
  GAME_ASSET_EVIDENCE_LABEL_LIST,
  GAME_ASSET_EVIDENCE_RULE,
} from './game-asset-designer-evidence';
import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for a planner delegating game asset work to the game asset designer. */
export function getEntryPointToGameAssetDesignerHandoffTemplate(
  query: HandoffTemplateQuery
): string {
  const entryPoint = query.fromRole;

  return `Instructions (not part of the message): Pass the asset request as a brief the designer can act on without guessing. Provide every field below; write \`Not specified.\` for a field you cannot fill and the designer will ask or apply a stated default. Ask for a specification and report only unless you explicitly request generation.

## Asset request
<one to three sentences: what the assets are for and the user-visible goal>

## Target
<engine and version; genre and camera; platform tier (mobile, PC, console, VR); render pipeline if known>

## Assets requested
<numbered list; each item: asset name, category (3D model, PBR textures, 2D sprite/UI, audio, other), purpose, quantity or variants>

## Budgets and conventions
<triangle budget per LOD, texel density or pixel grid, texture resolution and atlas limits, loudness target, naming convention, folder layout; or \`Not specified.\`>

## Style reference
<repository paths, URLs, or a written style sheet; or \`Not specified.\`>

## Deliverable mode
<\`spec only\` or \`spec and generate\`; if generating, the allowed tools and the exact output directory>

## Acceptance criteria
<what must be true for the planner to accept the delivery>

Instructions after the body (not part of the message): Use this template only under the conditions below; the body above ends at \`## Acceptance criteria\`.

### When to use the game asset designer
- the request creates or changes game art or audio assets (models, textures, sprites, UI art, sound effects);
- assets must meet engine import conventions or budgets before a builder integrates them;
- the user asks for an asset spec, style sheet, or asset audit.

Skip it for code-only work or for a trivial asset rename.

After completing the work, the game asset designer must return its delivery report to \`${entryPoint}\` with the normal handoff command.

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

  return `Instructions (not part of the message): Return a complete asset delivery report for the request the planner named. State only what you established. Label every checked property with one evidence label: ${GAME_ASSET_EVIDENCE_LABEL_LIST}. ${GAME_ASSET_EVIDENCE_RULE} Do not edit source code or write outside the named output location. Use the exact sections below, in this order.

## Summary
<one to three sentences: what was delivered, whether it is spec only or includes files, and the count of failed or unverified checks>

## Target and assumptions
<engine, version, platform tier, style reference used; each assumption you made and why>

## Asset manifest
<one entry per asset: name, category, file format, path (or \`Specified only.\`), dimensions/units/scale, pivot, naming, LOD list with triangle budgets, texture set with resolution, color space and channel packing, atlas/pixel grid/frame data, audio format and loudness target, import settings>

## Quality checklist results
<per asset: each applicable checklist item as \`pass\`, \`fail\`, or \`n/a\`, with its evidence label and, for \`measured\`, the command and value; write exactly \`None failed.\` after the list if no item failed>

## Style consistency
<how the set matches the style reference; deviations; what was compared and how>

## Files created
<repository-relative paths and a one-line description each; write exactly \`None.\` for spec only>

## Sources
<URLs for engine or platform rules relied on, with version or date checked>

## Open questions
<clarifications needed from the planner, each with a recommended default; write exactly \`None.\` if none>

## Not verified
<every property you could not measure or inspect; write exactly \`None.\` if none>

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
