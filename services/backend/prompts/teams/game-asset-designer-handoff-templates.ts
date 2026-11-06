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

  return `Instructions (not part of the message): Pass the asset request as a brief the designer can act on without guessing. Provide every field below; write \`Not specified.\` for a field you cannot fill and the designer will ask or apply a stated default, except \`## Lighting contract\`, which is required for a brief with any 3D asset and may be \`Not applicable.\` only when the brief has only 2D or audio assets. Pass goals and constraints as an open problem: do not author prompts, material treatment, style, or lighting art direction; the designer proposes the palette, lighting anchor, and prompts. Give each asset a stable ID (\`A01\`, \`A02\`…). Use \`spec only\` only when you want a specification with no files; the default is \`spec and generate\`. In \`## Allowed tools\`, keep the fixed line for each domain the brief contains and delete the others; name no other tool or generator. See the matching skill for how each tool is used. For a 3D model generated with AI also fill \`## Output paths\`; a procedural asset uses \`## Output location\` and the brief's allowed edit paths instead. Before generating anything, the designer evaluates each \`## Free asset candidates\` entry and records a \`use\`, \`adapt\`, or \`reject\` decision; it generates only the assets that no candidate covers. For a verification-only lighting brief, name the existing generated asset paths and the asset-in-rig render under \`## Existing assets\`; the designer applies only the lighting checklist item and does not generate, slice, or package.

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
<required for a brief with any 3D asset; \`Not specified.\` is not allowed, and \`Not applicable.\` is only for a brief with only 2D or audio assets. State the goal ("consistent with the game's rig and palette") plus the rig facts the repo defines: lighting model (image-based / directional / unlit / toon); environment map present or absent; metalness policy; exposure and tone mapping; colour space; shadow setup; the repository paths that define the rig; and a **rig reference render** path (required for a 3D asset; the designer cannot produce it): "the existing render of the target rig, attached by path under \`## Lighting contract\`, used as a style target before generation. It is input only and cannot support \`pass\`." The **asset-in-rig render** is "a render of the generated asset loaded in the project's real scene after generation, attached by path under \`## Lighting verification\`. Only this render supports \`pass\`." If you do not know a fact write \`Unknown: designer to read <path>\`. Do not write prompts, material treatment, or art direction; the designer owns those.>

## Perspective
<one camera perspective shared by every asset in the set, for example \`orthographic front view\`, \`orthographic isometric\`, \`dimetric 2:1\`, or \`side view\`; optionally \`reference: <repository path>\` of an existing asset to match. A reference constrains \`## Model\` to a reference-edit model, and every asset is then generated individually; the matching skill states which. \`Not Applicable.\` for 3D models and audio; or \`Not specified.\`>

## Model
<for a 2D asset: \`fal-ai/flux-2/flash\` (FLUX 2 Flash), passed as --model; \`fal-ai/flux-2/flash/edit\` only when \`## Perspective\` names a reference asset. For a 3D asset generated with AI: one fal 3D model id; \`chatroom generate-3d --help\` lists the known ids and the flags each takes. For a procedural 3D asset: \`procedural: <generator script path>\`. For a mixed brief, give one line per domain prefixed \`AI 2D:\` / \`AI 3D:\` / \`Procedural 3D:\`, matching the Allowed tools prefixes.>

## Model parameters
<a JSON object of model parameters, one object for every call of a set; its keys must pass the model's parameter check. For a mixed brief, give one line per domain prefixed \`AI 2D:\` / \`AI 3D:\` / \`Procedural 3D:\`, matching the Allowed tools prefixes. \`Not specified.\` if none. \`Not applicable.\` for a procedural asset (its parameters live in the config file named in \`## Allowed edit paths\`).>

## Cost confirmation
<the user's quoted approval of the priced generation plan, with the estimate it approved; or Not confirmed. \`Not applicable.\` for a procedural asset (no fal cost).>

## Output paths
<for a 3D model generated with AI: the \`--out\` path and the optional \`--package-dir\`; the run writes the package beside the master, and the matching skill names the files. \`Not Applicable.\` for a 2D-only request and for a procedural asset: its export path comes from \`## Output location\`, and its script, config, and output are named in \`## Allowed edit paths\`.>

## Spec consumer
<who integrates these assets from the spec: \`builder\` (application logic outside the allowed edit paths) or \`user\`; asset files themselves are generated only by \`game-asset-designer\`>

## Existing assets
<repository paths the designer must reuse or must not overwrite; for a verification-only lighting brief, the existing generated asset paths and the asset-in-rig render path; or \`Not specified.\`>

## Free asset candidates
<one entry per third-party pack to evaluate before generating: pack name, source URL, expected licence (for example CC0), formats, and the asset IDs it could cover; or \`None.\`. The designer checks each pack's own licence file and file sizes and gives each candidate a \`use\`, \`adapt\`, or \`reject\` decision. It fetches only the URLs named here, inspects the pack as static files, and never runs its code.>

## Deliverable mode
<\`spec and generate\` (default when you name an output location and allowed tools) or \`spec only\`>

## Allowed tools
<keep the line for each domain the brief contains and delete the others; \`None.\` for \`spec only\`.
AI 2D: \`chatroom generate-image --platform=fal --model <Model> (dry run first), chatroom slice-image, chatroom remove-image-background\`
AI 3D: \`chatroom generate-3d --platform=fal --model <Model> (dry run first), gltf-transform inspect\`
Procedural 3D: \`<generator script path> <run command>, git rev-parse HEAD, gltf-transform inspect\`>

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

Instructions after the body (not part of the message): the ${entryPoint} may append extra Proof of Principles lines if needed. Run the normal handoff command to \`game-asset-designer\` with the complete body above, then stop. Use this template only under the conditions below; the body above ends at \`## Proof of Completion\`.

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
  (rule) =>
    `- [ ] ${rule} — <evidence: command lines and output values; grid values when a sheet was generated; naming map reference when names came from a mapping>`
).join('\n');

/** Body for the game asset designer returning its delivery report to the entry role. */
export function getGameAssetDesignerToEntryPointHandoffTemplate(
  query: HandoffTemplateQuery
): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return a complete asset delivery report for the request the ${entryPoint} named. Label every checked property with one evidence label: ${GAME_ASSET_EVIDENCE_LABEL_LIST}. Definitions: ${GAME_ASSET_EVIDENCE_DEFINITIONS} ${GAME_ASSET_NEVER_CLAIM_RULE} ${GAME_ASSET_RESULT_RULE} Write only under the named output location and the named edit paths. In \`spec only\` you write no files. If you are blocked, send the same sections with Summary starting \`Blocked:\` and every section you could not reach written as \`Not started.\`

## Summary
<one to three sentences: what was delivered, whether it is spec only or includes files, and the count of \`fail\` and \`not checked\` items>

## Proof of Principles
${PROOF_OF_PRINCIPLES_REPORT}
- [ ] <append the domain Proof of Principles lines the matching skill lists, one per line>

## Proof of Completion
- [ ] <one checkbox per brief acceptance criterion; state the evidence label required (measured or inspected)>
- [ ] Every asset ID has a file or \`Specified only.\`
- [ ] Every sheet-derived asset was isolated and \`inspected\`.
- [ ] Manifests are listed in the asset manifest.
- [ ] Lighting verified under the brief's Lighting contract with an **asset-in-rig render**: "a render of the generated asset loaded in the project's real scene after generation, attached by path under \`## Lighting verification\`. Only this render supports \`pass\`." The **rig reference render** is "the existing render of the target rig, attached by path under \`## Lighting contract\`, used as a style target before generation. It is input only and cannot support \`pass\`."; otherwise the Summary starts \`Delivered, lighting not verified:\`.
- [ ] Every candidate in the brief has a decision with its licence and file sizes labelled \`inspected\`.

## Target and assumptions
<each assumption you made and why; each deviation from the ${entryPoint}'s target or budgets; or \`None.\`>

## Free asset decisions
<one entry per candidate in the brief: pack name, licence quoted from the pack's own licence file, file sizes checked, decision (\`use\`, \`adapt\`, or \`reject\`), asset IDs covered, and the reason; for \`adapt\`, the edits made; write exactly \`None.\` if the brief named no candidates>

## Asset manifest
<one entry per asset, keyed by the ${entryPoint}'s stable ID (\`A01\`…): name, category, file format, path (or \`Specified only.\`), dimensions/units/scale, pivot, naming, LOD list with triangle budgets, texture set with resolution, color space and channel packing, atlas/pixel grid/frame data, audio format and loudness target, import settings, dependencies and variants; for each budget, the acceptance check (exact command and expected value); for each generated file, the command line the matching skill requires (model, seed, parameters, and any generator-specific flags), the sheet and tile manifests, and the isolated asset manifest path>

## Quality checklist results
<per asset: each applicable checklist item as \`pass\`, \`fail\`, \`n/a\`, or \`not checked\`, with its evidence label and, for \`measured\`, the command and value; write exactly \`None failed.\` after the list if no item failed>

## Style consistency
<how the set matches the style reference; deviations; what was compared and how>

## Lighting verification
<per 3D asset: the lighting contract you applied; the shared palette/lighting anchor you used; an **asset-in-rig render**: "a render of the generated asset loaded in the project's real scene after generation, attached by path under \`## Lighting verification\`. Only this render supports \`pass\`."; the **rig reference render** path: "the existing render of the target rig, attached by path under \`## Lighting contract\`, used as a style target before generation. It is input only and cannot support \`pass\`."; result \`pass\`, \`fail\`, or \`not checked\` with its evidence label. For an AI-generated 3D asset also record the preview inspection marked \`not checked\` with the reason "no allowed capture tool" (no allowed tool captures Directional or Unlit views; Studio is image-based lighting and is never evidence); a procedural asset has no preview. In a verification-only brief (existing asset paths and an asset-in-rig render named), apply only this lighting item to those files; do not regenerate, slice, or package. If any asset is \`not checked\`, the Summary must start \`Delivered, lighting not verified:\`. Write \`n/a\` for 2D-only or audio-only requests and for \`spec only\` deliverables (no asset is rendered).>

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
<each clarification needed from the ${entryPoint} with a recommended default; write exactly \`None.\` if none>

## Not verified
<every property you could not measure or inspect; write exactly \`None.\` if none>

## Recommended next step
<exactly one target: \`game-asset-designer\` (re-run with the listed asset IDs), \`builder\` (application logic outside the allowed edit paths), \`uiux-engineer\` (layout, component, or styling changes only, never asset files), or \`${entryPoint}\` (decision needed on an open question); then the affected asset IDs>

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
