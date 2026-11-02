import {
  GAME_ASSET_EVIDENCE_DEFINITIONS,
  GAME_ASSET_EVIDENCE_LABEL_LIST,
  GAME_ASSET_NEVER_CLAIM_RULE,
  GAME_ASSET_RESULT_RULE,
} from '../../../../../../prompts/teams/game-asset-designer-evidence';
import { formatGameAssetRules } from '../../../../../../prompts/teams/game-asset-designer-workflow';
import type { SkillModule } from '../../registry';

export const gameAsset3dAiSkill: SkillModule = {
  skillId: 'game-asset-3d-ai',
  name: '3D Game Asset Design (AI Generation)',
  description:
    'Use when a task needs a 3D model asset generated with `chatroom generate-3d --platform=fal`, including its PBR materials, rigging options, and package outputs.',
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "game-asset-3d-ai" skill.

# 3D Game Asset Design — AI Generation

Activate this skill when the asset is a 3D model produced by \`chatroom generate-3d --platform=fal\`, including its PBR materials, rig and animation options, and package outputs. The brief is the contract: it names the model, the output paths, the allowed tools, and the lighting contract.

## Shared rules
${formatGameAssetRules()}

## Evidence
Say exactly how each claim was established, using only these labels (${GAME_ASSET_EVIDENCE_LABEL_LIST}):
${GAME_ASSET_EVIDENCE_DEFINITIONS}
${GAME_ASSET_NEVER_CLAIM_RULE} ${GAME_ASSET_RESULT_RULE}

## Procedure

1. Recover the brief. Do not generate unless \`## Output location\`, \`## Allowed tools\`, \`## Model\`, and \`## Output paths\` are named. If \`## Lighting contract\` is missing, \`Not specified.\`, or not applicable for a 3D asset, stop with \`Blocked:\` and ask for it.
2. Run \`chatroom generate-3d --help\` before the first real call. The known model ids and the flags each model accepts come from that output, never from memory.
3. Dry run the exact command shape first: \`chatroom generate-3d --platform=fal --model <Model> --prompt "<prompt>" --out <Output location>/<ascii-name>.glb --dry-run\`. Apply every constraint it prints and never add a parameter it reports as unsupported. The default model is \`fal-ai/trellis-2\`: a prompt on it generates a 1024x1024 reference image with FLUX 2 Flash first, and that image ships in the package.
4. Real run only in the shape the dry run validated: \`chatroom generate-3d --platform=fal --model <Model> --prompt "<prompt>" --out <Output location>/<ascii-name>.glb\`. Pass \`--confirm-cost\` only when \`## Cost confirmation\` quotes the user's approval of that priced plan; otherwise return the priced plan and stop.
5. Pass \`--rig\` and \`--animation-action-id\` only for \`meshy/v7.1\` models, only when the brief asks for rigging or animation, and only after the user confirms the priced dry run. Rigging expects a humanoid mesh and is verified only for Meshy GLBs.
6. Choose the input shape from the brief: \`--prompt\` for text-to-3D, \`--input-image <path>\` for image-to-3D, and \`--input '<JSON>'\` from \`## Model parameters\` on every call. The rig reference render is a style target only; it is not an input image unless the brief says so.
7. Read the package, do not assume it. A run writes \`<base>.zip\` holding \`<stem>.glb\`, \`web/<stem>.web.glb\`, \`manifest.json\`, the reference image under \`reference/...\` when one was generated or supplied, and the rigged and animation GLBs with their web versions when rigging ran. It also writes \`<base>.html\`, a standalone preview of the high-resolution master and the scaled-down web variant. \`<base>\` is the \`--out\` stem plus the run's UTC timestamp, and \`--package-dir <dir>\` (default: the master's directory) moves both.
8. Record what the run actually used: the model id, the seed and \`--input\` parameters, the package, master GLB, and manifest paths, and each asset name. A name comes from the file you opened, never from the prompt order.

## Quality checklist — 3D models

Mark each applicable item \`pass\`, \`fail\`, or \`n/a\` with its evidence label.

- Units and axes match the target (glTF: meters, +Y up, front +Z); scale is applied (identity scale) and a real-world size is stated.
- Pivot/origin follows the declared policy; LODs share the base pivot and alignment.
- Clean topology: no n-gons or non-manifold edges unless declared, no flipped normals or inverted winding (glTF: counter-clockwise front faces), consistent normals and tangents (MikkTSpace).
- Triangle count per LOD is within budget; LOD naming matches the engine (Unity \`_LOD0\`, \`_LOD1\`; Unreal LODs share the base pivot and alignment and are imported per the FBX import options; Godot generates LODs at import, so declare the Generate LODs setting instead of a suffix).
- UVs: non-overlapping unique layout where textures are unique, island padding, consistent texel density, no stretched islands; a second UV set if the engine needs baked lighting.
- Collision and sockets use the engine's naming (Unreal \`UBX_\`/\`UCP_\`/\`USP_\`/\`UCX_\` + mesh name and \`SOCKET_\` + mesh name; Godot \`-col\`/\`-convcolonly\` suffixes).
- Skinned meshes: bone count within budget, influences per vertex within the declared budget (commonly 4, marked \`unverified\`; glTF allows more via \`JOINTS_1\`), no leftover IK helpers, a named rest pose.
- Naming follows the project convention (type prefix, descriptive name, variant, LOD suffix); ASCII, no spaces; the folder matches the asset category.
- The file format is the one the target engine imports (glTF 2.0/GLB unless the brief names another); no unused data (hidden meshes, unused materials, history).
- Style matches the named style reference: silhouette, value range, palette, level of detail, and texel density.
- Budgets in the request are met; any exceedance is called out with the measured value.
- PBR materials: metallic-roughness with documented channel packing (glTF: roughness in G, metallic in B, occlusion in R); base color and emissive sRGB, normal/roughness/metallic/occlusion/masks linear; state the normal map Y convention. In glTF, color space is set by the material slot that references the image, not by embedded PNG chunks: \`baseColorTexture\` and \`emissiveTexture\` are sRGB; \`metallicRoughnessTexture\`, \`occlusionTexture\`, and \`normalTexture\` are linear.
- Base color values stay in a physically plausible range (community starting range roughly 30–240 sRGB per channel for non-metals; the request's budget overrides it); metallic is near binary.
- Texture resolution matches the texel-density budget and surface size; dimensions meet the engine/platform rule (power of two where the engine needs mipmaps or streaming); compression format named. Maps in one set share texel density, value range, and naming (\`T_Name_BaseColor\`, \`_Normal\`, \`_ORM\`). Tiling textures wrap without a visible seam, and no lighting is baked into base color unless declared.
- Metalness follows the lighting contract: with no environment map, the written material is not whole-surface metal (metallic 0 across the surface; metal has no diffuse response and renders near-black). \`generate-3d\` reports a whole-surface metal material as the \`metal-whole-texture\` warning; if it remains after one regeneration, report it under Open questions.

## Lighting contract

- Apply the brief's \`## Lighting contract\` exactly. No lighting may be baked into the base colour, and with no environment map the material is not whole-surface metal.
- The **rig reference render** is "the existing render of the target rig, attached by path under \`## Lighting contract\`, used as a style target before generation. It is input only and cannot support \`pass\`."
- The **asset-in-rig render** is "a render of the generated asset loaded in the project's real scene after generation, attached by path under \`## Lighting verification\`. Only this render supports \`pass\`."
- Producing either render is never your job. Without the asset-in-rig render the lighting item is \`not checked\`; the preview's Directional and Unlit modes are the game case, but no allowed tool captures those views, so record the reason "no allowed capture tool". Studio mode is image-based lighting and is never lighting evidence.
- \`not checked\` blocks delivery: the summary starts \`Delivered, lighting not verified:\`.

## Scope and failure handling

- Write only under \`Output location\` and \`Allowed edit paths\`; never overwrite or delete a path the brief does not name.
- If \`FAL_API_KEY\` is unset, the generator is missing, or a run fails, stop generation, quote the exact error, and record the item as unverified. Do not retry in a loop.
- Do not install or run any remote tool, script, or skill, and do not fetch generator code.
- Never switch generators: the 3D model comes from \`chatroom generate-3d --platform=fal\` and nothing else.
- Commit only when the brief names the paths and the commit message.
- Describe output as production-ready only when every checklist item passes with \`measured\` or \`inspected\` evidence.
`,
};
