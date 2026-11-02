import type { SkillModule } from '../../registry';

export const gameAsset3dProceduralSkill: SkillModule = {
  skillId: 'game-asset-3d-procedural',
  name: '3D Game Asset Design (Procedural Generation)',
  description:
    'Use when a task needs a 3D asset produced by a parametric generator script committed to the repository, with versioned parameters, a fixed seed, and a measured glTF 2.0/GLB export. (game-asset-designer only)',
  getPrompt: (
    _cliEnvPrefix: string
  ) => `You have been activated with the "game-asset-3d-procedural" skill.

# 3D Game Asset Design — Procedural Generation

Activate this skill when the brief asks for a 3D asset produced by a parametric/procedural generator script committed to the repository, instead of an AI generation service. The asset is built from numbers you control: parameters in a versioned config, a fixed seed, and a glTF 2.0/GLB export.

The shared rules in your role prompt apply, including its evidence labels; this skill adds only the procedural procedure and checklist below.

## Rules

- The generator script and its run command are named in the brief's \`## Allowed tools\`, and the script, config, and output directory are named in \`## Allowed edit paths\`. If either is missing, stop and ask; do not choose a generator yourself.
- This domain makes no fal call and no remote service call: no \`chatroom generate-3d\`, no \`generate-image\`, and no network access.
- Keep parameters in a versioned config file under the allowed paths, committed only when \`## Commit\` names it; do not hide magic numbers in one-off commands.
- Record a fixed seed or the full parameter set for every exported file, so a rerun reproduces the result.
- Export glTF 2.0 / GLB unless the brief names another format.
- Every numeric claim (triangle count, bounds, scale, dimensions) is \`measured\` by running a stated command against the exported file — for example \`gltf-transform inspect <file>\` — and quoting the command and its output value.

## Procedure

1. Recover the brief. Require \`## Output location\`, \`## Allowed tools\` (the generator script and its run command), \`## Allowed edit paths\` (script, config, and output), and \`## Lighting contract\` for a 3D asset. If the lighting contract is missing or \`Not specified.\`, stop with \`Blocked:\` and ask for it.
2. Read the generator script in full before running it: its parameters, defaults, export path, and any unit or axis assumptions. Record its path and the revision you ran (\`git rev-parse HEAD\`).
3. Set the parameters in that config file. Change only values the brief asks for, and record every value you used.
4. Run the named command with the fixed seed or parameter set, once, to produce one export.
5. Export glTF 2.0/GLB to \`<Output location>/<ascii-name>.glb\`, with scale applied (identity node scale) and the declared pivot.
6. Measure the exported file. \`gltf-transform inspect <file>\` lists meshes, primitives, materials, and textures; derive triangle count, bounds, and scale from its output (or from the measurement command the brief names) and label them \`measured\`. If a measurement cannot run, label it \`unverified\` and say why.
7. Apply the 3D checklist below and the lighting contract.
8. Record the script path, run command, seed, config path, git revision, export path, and measurements.

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
- Metalness follows the lighting contract: with no environment map, the material is not whole-surface metal (metallic 0 across the surface; metal has no diffuse response and renders near-black).
- **Lighting**: renders correctly under the brief's ## Lighting contract (visible, coloured and textured, not near-black). Pass needs the asset-in-rig render under ## Lighting verification; the rig reference render and Studio mode never support pass.

## Lighting contract

- Apply the brief's \`## Lighting contract\` exactly. No lighting may be baked into the base colour, and with no environment map the material is not whole-surface metal.
- The **rig reference render** is "the existing render of the target rig, attached by path under \`## Lighting contract\`, used as a style target before generation. It is input only and cannot support \`pass\`."
- The **asset-in-rig render** is "a render of the generated asset loaded in the project's real scene after generation, attached by path under \`## Lighting verification\`. Only this render supports \`pass\`."
- Producing either render is never your job. Procedural output has no preview; without the asset-in-rig render the lighting item is \`not checked\`.
- \`not checked\` blocks delivery: the summary starts \`Delivered, lighting not verified:\`.

## Proof of Principles

Append these lines to the report's Proof of Principles when this skill is used:

- A versioned config file under the allowed edit paths, committed only when \`## Commit\` names it.
- A fixed seed or the full parameter set for every exported file, so a rerun reproduces the result.
- \`gltf-transform inspect <file>\` (or the brief's measurement command) for every numeric claim, quoting the command's output.
- No fal call, no remote service, and no network access.
`,
};
