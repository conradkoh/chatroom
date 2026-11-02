/**
 * Shared 3D model checklist for the `game-asset-3d-ai` and
 * `game-asset-3d-procedural` skills.
 *
 * Lives outside `modules/`, which holds one `<skill-id>/index.ts` per registry
 * skill (see `../registry.ts`). This file is a helper shared by two skills,
 * not a skill itself.
 *
 * Every line both skills share lives here so the two prompts cannot drift.
 * The metalness line is a parameter: the AI skill names the generator's
 * `metal-whole-texture` warning, while a procedural generator reports none.
 */

export interface Format3dModelChecklistOptions {
  /** The metalness checklist line, including the skill's generator warning rule. */
  metalnessLine: string;
}

export function format3dModelChecklist({ metalnessLine }: Format3dModelChecklistOptions): string {
  return [
    'Units and axes match the target (glTF: meters, +Y up, front +Z); scale is applied (identity scale) and a real-world size is stated.',
    'Pivot/origin follows the declared policy; LODs share the base pivot and alignment.',
    'Clean topology: no n-gons or non-manifold edges unless declared, no flipped normals or inverted winding (glTF: counter-clockwise front faces), consistent normals and tangents (MikkTSpace).',
    'Triangle count per LOD is within budget; LOD naming matches the engine (Unity `_LOD0`, `_LOD1`; Unreal LODs share the base pivot and alignment and are imported per the FBX import options; Godot generates LODs at import, so declare the Generate LODs setting instead of a suffix).',
    'UVs: non-overlapping unique layout where textures are unique, island padding, consistent texel density, no stretched islands; a second UV set if the engine needs baked lighting.',
    "Collision and sockets use the engine's naming (Unreal `UBX_`/`UCP_`/`USP_`/`UCX_` + mesh name and `SOCKET_` + mesh name; Godot `-col`/`-convcolonly` suffixes).",
    'Skinned meshes: bone count within budget, influences per vertex within the declared budget (commonly 4, marked `unverified`; glTF allows more via `JOINTS_1`), no leftover IK helpers, a named rest pose.',
    'PBR materials: metallic-roughness with documented channel packing (glTF: roughness in G, metallic in B, occlusion in R); base color and emissive sRGB, normal/roughness/metallic/occlusion/masks linear; state the normal map Y convention. In glTF, color space is set by the material slot that references the image, not by embedded PNG chunks. Verify the slot for each map: `baseColorTexture` and `emissiveTexture` are sRGB; `metallicRoughnessTexture`, `occlusionTexture`, and `normalTexture` are linear.',
    "Base color values stay in a physically plausible range (community starting range roughly 30–240 sRGB per channel for non-metals; the request's budget overrides it); metallic is near binary.",
    'Texture resolution matches the texel-density budget and surface size; dimensions meet the engine/platform rule (power of two where the engine needs mipmaps or streaming, for example Unreal; confirm for the target engine version); compression format named. Maps in one set share texel density, value range, and naming (`T_Name_BaseColor`, `_Normal`, `_ORM`). Tiling textures wrap without a visible seam, and no baked-in lighting or text in base color unless declared.',
    metalnessLine,
    "**Lighting**: renders correctly under the brief's `## Lighting contract` (visible, coloured and textured, not near-black). Pass needs the asset-in-rig render under `## Lighting verification`; the rig reference render and Studio mode never support pass. (the same item as in All assets; mark it once)",
  ]
    .map((line) => `- ${line}`)
    .join('\n');
}
