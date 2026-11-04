import type { SkillModule } from '../../registry';
import { format3dModelChecklist } from '../../shared/game-asset-3d-checklist';

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
- Every numeric claim (triangle count, bounds, scale, dimensions) is \`measured\` by running \`gltf-transform inspect <file>\` against the exported file and quoting the command and its output value.

## Procedure

1. Recover the brief. Require \`## Output location\`, \`## Allowed tools\` (the generator script and its run command), \`## Allowed edit paths\` (script, config, and output), and \`## Lighting contract\` for a 3D asset. If the lighting contract is missing or \`Not specified.\`, stop with \`Blocked:\` and ask for it.
2. Read the generator script in full before running it: its parameters, defaults, export path, and any unit or axis assumptions. Record its path and the revision you ran (\`git rev-parse HEAD\`).
3. Set the parameters in that config file. Change only values the brief asks for, and record every value you used.
4. Run the named command with the fixed seed or parameter set, once, to produce one export.
5. Export glTF 2.0/GLB to \`<Output location>/<ascii-name>.glb\`, with scale applied (identity node scale) and the declared pivot.
6. Measure the exported file. \`gltf-transform inspect <file>\` lists meshes, primitives, materials, and textures; derive triangle count, bounds, and scale from its output and label them \`measured\`. If a measurement cannot run, label it \`unverified\` and say why.
7. Apply the 3D checklist below and the lighting contract.
8. Record the script path, run command, seed, config path, git revision, export path, and measurements.

## Quality checklist — 3D models

Mark each applicable item \`pass\`, \`fail\`, \`n/a\`, or \`not checked\` with its evidence label.

Also apply the role prompt's All assets checklist.

${format3dModelChecklist({
  metalnessLine:
    'Metalness follows the lighting contract: with no environment map, the material is not whole-surface metal (metallic 0 across the surface; metal has no diffuse response and renders near-black).',
})}

## Lighting contract

- Procedural output has no preview.

## Procedural animation reference

Reference knowledge for procedural (runtime) motion of creatures built from chains. Source: argonaut, "A simple procedural animation technique". Use it when a brief or builder slice needs such motion; the designer does not implement animation.

### Distance-constraint chains

- Procedural animation computes motion at runtime instead of playing pre-baked keyframes.
- An anchor point and a distance constraint (a circle of radius r) make a secondary point follow the anchor.
- Linking several distance constraints in a line gives a flexible spine or worm-like chain.

### Spine bodies and outlines

- Assign a body radius to each chain point and treat the chain as the spine.
- Compute left and right skin coordinates per segment with circle parametric equations and ±90° (quarter-turn) offsets from the spine direction. This yields continuous outlines and features such as eyes or fins.

### Angle constraints

- Limit how sharply adjacent segments can bend relative to each other.
- Without this a flexible chain can loop over itself or break shape. Choose thresholds that mirror real anatomy.

### Fins and curvature

- Attach fins by relative rotation to segments so they lag and lead the motion instead of staying rigid.
- Sum the angular differences across body segments to get overall curvature; dorsal and tail fins then flex with how hard the creature turns.

## Proof of Principles

Append these lines to the report's Proof of Principles when this skill is used:

- A versioned config file under the allowed edit paths, committed only when \`## Commit\` names it.
- A fixed seed or the full parameter set for every exported file, so a rerun reproduces the result.
- \`gltf-transform inspect <file>\` for every numeric claim, quoting the command's output.
- No fal call, no remote service, and no network access.
`,
};
