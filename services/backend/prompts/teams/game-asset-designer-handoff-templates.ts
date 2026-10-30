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

  return `Instructions (not part of the message): Pass the asset request as a brief the designer can act on without guessing. Provide every field below; write \`Not specified.\` for a field you cannot fill and the designer will ask or apply a stated default, except \`## Lighting contract\`, which is always required. Pass goals and constraints as an open problem: do not author prompts, material treatment, style, or lighting art direction; the designer proposes the palette, lighting anchor, and prompts. Give each asset a stable ID (\`A01\`, \`A02\`…). Use \`spec only\` only when you want a specification with no files; the default is \`spec and generate\`. The \`## Allowed tools\` value is fixed: \`chatroom generate-image --platform=fal --model <Model> (dry run first), chatroom generate-3d --platform=fal --model <Model> (dry run first), chatroom slice-image, chatroom remove-image-background\`. Do not name any other generator; for a 3D model also fill \`## Output paths\`, whose \`--package-dir\` stays on the \`generate-3d\` entry. Before generating anything, the designer evaluates each \`## Free asset candidates\` entry and records a \`use\`, \`adapt\`, or \`reject\` decision; it generates only the assets that no candidate covers.

## Asset request
<one to three sentences: what the assets are for and the user-visible goal>

## Target
<engine and version; genre and camera; platform tier (mobile, PC, console, VR); render pipeline (renderer, tone mapping) if known; lighting goes in the Lighting contract>

## Assets requested
<numbered list with stable IDs \`A01\`, \`A02\`…; each item: asset name, category (3D model, PBR textures, 2D sprite/UI, audio, other), purpose, quantity or variants>

## Budgets and conventions
<triangle budget per LOD, texel density or pixel grid, texture resolution and atlas limits, loudness target, naming convention, folder layout; or \`Not specified.\`>

## Style reference
<repository paths, URLs, or a written style sheet; or \`Not specified.\`>

## Lighting contract
<required; \`Not specified.\` is not allowed. State the goal ("consistent with the game's rig and palette") plus the rig facts the repo defines: lighting model (image-based / directional / unlit / toon); environment map present or absent; metalness policy; exposure and tone mapping; colour space; shadow setup; the repository paths that define the rig; and a target-rig reference render path if one exists. If you do not know a fact write \`Unknown: designer to read <path>\`. Do not write prompts, material treatment, or art direction; the designer owns those.>

## Perspective
<one camera perspective shared by every asset in the set, for example \`orthographic front view\`, \`orthographic isometric\`, \`dimetric 2:1\`, or \`side view\`; optionally \`reference: <repository path>\` of an existing asset to match (requires \`## Model\` = \`fal-ai/flux-2/flash/edit\`); a reference makes every asset an individual edit, with no sheets; \`Not Applicable.\` for 3D models and audio; or \`Not specified.\`>

## Model
<for a 2D asset: \`fal-ai/flux-2/flash\` (FLUX 2 Flash), passed as --model; \`fal-ai/flux-2/flash/edit\` only when \`## Perspective\` names a reference asset. For a 3D model: one fal 3D model id; \`chatroom generate-3d --help\` lists the known ids and the flags each takes>

## Model parameters
<a JSON object as text passed to \`generate-image --input\`, or to \`generate-3d --input\` for a 3D model; one object for every call of a set; its keys must pass the model's --dry-run check; \`Not specified.\` if none>

## Cost confirmation
<the user's quoted approval of the priced dry run, with the estimate it approved; or Not confirmed.>

## Output paths
<for a 3D model: the \`--out\` path, whose file name becomes the package base \`<out-stem>-<timestamp>\`, and the optional \`--package-dir\` directory (default: the master's directory). The run writes \`<base>.zip\` (\`<stem>.glb\`, \`web/<stem>.web.glb\`, \`manifest.json\`) and \`<base>.html\`, a separate preview of the web variant, beside the master or in that directory. \`Not Applicable.\` for a 2D-only request>

## Spec consumer
<who integrates these assets from the spec: \`builder\` (application logic outside the allowed edit paths) or \`user\`; asset files themselves are generated only by \`game-asset-designer\`>

## Existing assets
<repository paths the designer must reuse or must not overwrite; or \`Not specified.\`>

## Free asset candidates
<one entry per third-party pack to evaluate before generating: pack name, source URL, expected licence (for example CC0), formats, and the asset IDs it could cover; or \`None.\`. The designer checks each pack's own licence file and file sizes and gives each candidate a \`use\`, \`adapt\`, or \`reject\` decision. It fetches only the URLs named here, inspects the pack as static files, and never runs its code.>

## Deliverable mode
<\`spec and generate\` (default when you name an output location and allowed tools) or \`spec only\`>

## Allowed tools
\`chatroom generate-image --platform=fal --model <Model> (dry run first), chatroom generate-3d --platform=fal --model <Model> (dry run first), chatroom slice-image, chatroom remove-image-background\`

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

Skip it for code-only work. Non-game UI icons and illustrations also go to this role; they are not sent to \`uiux-engineer\`.

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
- [ ] Lighting verified under the brief's Lighting contract, or the Summary starts \`Blocked: lighting not verified\`.
- [ ] Every candidate in the brief has a decision with its licence and file sizes labelled \`inspected\`.

## Target and assumptions
<each assumption you made and why; each deviation from the planner's target or budgets; or \`None.\`>

## Free asset decisions
<one entry per candidate in the brief: pack name, licence quoted from the pack's own licence file, file sizes checked, decision (\`use\`, \`adapt\`, or \`reject\`), asset IDs covered, and the reason; for \`adapt\`, the edits made; write exactly \`None.\` if the brief named no candidates>

## Asset manifest
<one entry per asset, keyed by the planner's stable ID (\`A01\`…): name, category, file format, path (or \`Specified only.\`), dimensions/units/scale, pivot, naming, LOD list with triangle budgets, texture set with resolution, color space and channel packing, atlas/pixel grid/frame data, audio format and loudness target, import settings, dependencies and variants; for each budget, the acceptance check (exact command and expected value); for each generated file, the generator command line (\`chatroom generate-image\` with its \`--platform\`, \`--model\`, \`--seed\`, \`--input\`, and \`--input-image\` values, or \`chatroom generate-3d\` with its \`--platform\`, \`--model\`, \`--prompt\`/\`--input-image\`, \`--input\`, \`--rig\`, and \`--animation-action-id\` values), the sheet and tile manifests, and the isolated asset manifest path>

## Quality checklist results
<per asset: each applicable checklist item as \`pass\`, \`fail\`, \`n/a\`, or \`not checked\`, with its evidence label and, for \`measured\`, the command and value; write exactly \`None failed.\` after the list if no item failed>

## Style consistency
<how the set matches the style reference; deviations; what was compared and how>

## Lighting verification
<per 3D asset: the lighting contract you applied; the shared palette/lighting anchor you used; the preview mode(s) you inspected (Directional and Unlit are the game case; Studio is not evidence); the path of any render under the project's real rig; result \`pass\`, \`fail\`, or \`not checked\` with its evidence label. If any asset is \`not checked\`, the Summary must start \`Blocked: lighting not verified\`. Write \`n/a\` for 2D-only or audio-only requests.>

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
<exactly one target: \`game-asset-designer\` (re-run with the listed asset IDs), \`builder\` (application logic outside the allowed edit paths), \`uiux-engineer\` (layout, component, or styling changes only, never asset files), or \`planner\` (decision needed on an open question); then the affected asset IDs>

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
