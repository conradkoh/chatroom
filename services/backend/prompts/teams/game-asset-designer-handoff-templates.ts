import {
  GAME_ASSET_EVIDENCE_DEFINITIONS,
  GAME_ASSET_EVIDENCE_LABEL_LIST,
  GAME_ASSET_NEVER_CLAIM_RULE,
  GAME_ASSET_RESULT_RULE,
} from './game-asset-designer-evidence';
import { GAME_ASSET_RULES, formatProofOfPrinciples } from './game-asset-designer-workflow';
import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for a planner delegating game asset work to the game asset designer. */
export function getEntryPointToGameAssetDesignerHandoffTemplate(
  query: HandoffTemplateQuery
): string {
  const entryPoint = query.fromRole;

  return `Instructions (not part of the message): Pass the asset request as a brief the designer can act on without guessing. Provide every field below; write \`Not specified.\` for a field you cannot fill and the designer will ask or apply a stated default. Give each asset a stable ID (\`A01\`, \`A02\`…). Use \`spec only\` only when you want a specification with no files; the default is \`spec and generate\`. The \`## Allowed tools\` value is fixed: \`chatroom generate-image --platform=fal (default model), chatroom slice-image, chatroom remove-image-background\`. Do not name any other generator.

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

## Model
<the CLI default \`fal-ai/flux-2/flash\`, or \`fal-ai/moss-image\` when the brief names it>

## Model parameters
<a JSON object as text passed to \`generate-image --input\`; \`Not specified.\` if none>

## Spec consumer
<who integrates these assets from the spec: \`builder\` (application code) or \`user\`; asset files themselves are generated only by \`game-asset-designer\`>

## Existing assets
<repository paths the designer must reuse or must not overwrite; or \`Not specified.\`>

## Deliverable mode
<\`spec and generate\` (default when you name an output location and allowed tools) or \`spec only\`>

## Allowed tools
\`chatroom generate-image --platform=fal (default model), chatroom slice-image, chatroom remove-image-background\`

## Allowed edit paths
<repository-relative paths the designer may edit; \`None.\` for none>

## Commit
<\`None.\` or the commit message and the paths to commit>

## Sheet grid
2x2

Larger only as \`CxR (requested by user: "<quote>")\`.

## Output location
<the exact repository directory the designer may write to; required for \`spec and generate\`; \`None.\` for \`spec only\`>

## Proof of Principles
${formatProofOfPrinciples()}

## Proof of Completion
- [ ] <one checkbox per acceptance criterion; state the evidence label required (measured or inspected)>

Instructions after the body (not part of the message): the planner may append extra Proof of Principles lines if needed. Run the normal handoff command to \`game-asset-designer\` with the complete body above, then stop. Use this template only under the conditions below; the body above ends at \`## Proof of Completion\`.

### When to use the game asset designer
- the request creates or changes any asset file: game art or audio (models, textures, sprites, UI art, sound effects), or non-game UI icons and illustrations;
- assets must meet engine import conventions or budgets before a builder integrates them;
- the user asks for an asset spec, style sheet, or asset audit.

Skip it for code-only work and for a trivial asset rename. Non-game UI icons and illustrations also go to this role; they are not sent to \`uiux-engineer\`.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'game-asset-designer',
  cliEnvPrefix: '',
})}
\`\`\``;
}

const PROOF_OF_PRINCIPLES_REPORT = GAME_ASSET_RULES.map(
  (rule) => `- [ ] ${rule} — <evidence: command lines, grid values, or naming map reference>`
).join('\n');

/** Body for the game asset designer returning its delivery report to the entry role. */
export function getGameAssetDesignerToEntryPointHandoffTemplate(
  query: HandoffTemplateQuery
): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return a complete asset delivery report for the request the planner named. Label every checked property with one evidence label: ${GAME_ASSET_EVIDENCE_LABEL_LIST}. Definitions: ${GAME_ASSET_EVIDENCE_DEFINITIONS} ${GAME_ASSET_NEVER_CLAIM_RULE} ${GAME_ASSET_RESULT_RULE} Write only under the named output location and the named edit paths. In \`spec only\` you write no files. If you are blocked, send the same sections with Summary starting \`Blocked:\` and every section you could not reach written as \`Not started.\`

## Summary
<one to three sentences: what was delivered, whether it is spec only or includes files, and the count of \`fail\` and \`not checked\` items>

## Proof of Principles
${PROOF_OF_PRINCIPLES_REPORT}

## Proof of Completion
- [ ] <one checkbox per brief acceptance criterion; state the evidence label required (measured or inspected)>
- [ ] Every asset ID has a file or \`Specified only.\`
- [ ] Every sliced asset was isolated with \`remove-image-background\` and \`inspected\`.
- [ ] Manifests are listed in the asset manifest.

## Target and assumptions
<each assumption you made and why; each deviation from the planner's target or budgets; or \`None.\`>

## Asset manifest
<one entry per asset, keyed by the planner's stable ID (\`A01\`…): name, category, file format, path (or \`Specified only.\`), dimensions/units/scale, pivot, naming, LOD list with triangle budgets, texture set with resolution, color space and channel packing, atlas/pixel grid/frame data, audio format and loudness target, import settings, dependencies and variants; for each budget, the acceptance check (exact command and expected value); for each generated file, the generator command line (\`chatroom generate-image\` with its \`--platform\`, \`--model\`, and \`--seed\` values), the sheet and tile manifests, and the isolated asset manifest path>

## Quality checklist results
<per asset: each applicable checklist item as \`pass\`, \`fail\`, \`n/a\`, or \`not checked\`, with its evidence label and, for \`measured\`, the command and value; write exactly \`None failed.\` after the list if no item failed>

## Style consistency
<how the set matches the style reference; deviations; what was compared and how>

## Naming map
| cell stem | seen | assigned name | path | inspection note |
| --- | --- | --- | --- | --- |

Write exactly \`None.\` if no sheet was used.

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
<exactly one target: \`game-asset-designer\` (re-run with the listed asset IDs), \`builder\` (integrate, or apply the listed import settings), \`uiux-engineer\` (layout, component, or styling changes only, never asset files), or \`planner\` (decision needed on an open question); then the affected asset IDs>

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
