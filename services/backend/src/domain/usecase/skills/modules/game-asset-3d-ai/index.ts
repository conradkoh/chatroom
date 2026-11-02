import type { SkillModule } from '../../registry';
import { format3dModelChecklist } from '../../shared/game-asset-3d-checklist';

export const gameAsset3dAiSkill: SkillModule = {
  skillId: 'game-asset-3d-ai',
  name: '3D Game Asset Design (AI Generation)',
  description:
    'Use when a task needs a 3D model asset generated with `chatroom generate-3d --platform=fal`, including its PBR materials, rigging options, and package outputs. (game-asset-designer only)',
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "game-asset-3d-ai" skill.

# 3D Game Asset Design — AI Generation

Activate this skill when the asset is a 3D model produced by \`chatroom generate-3d --platform=fal\`, including its PBR materials, rig and animation options, and package outputs. The brief is the contract: it names the model, the output paths, the allowed tools, and the lighting contract.

The shared rules in your role prompt apply, including its evidence labels; this skill adds only the 3D procedure and checklist below.

## Procedure

1. Recover the brief. Do not generate unless \`## Output location\`, \`## Allowed tools\`, \`## Model\`, and \`## Output paths\` are named. If \`## Lighting contract\` is missing, \`Not specified.\`, or not applicable for a 3D asset, stop with \`Blocked:\` and ask for it.
2. Run \`chatroom generate-3d --help\` before the first real call. The known model ids and the flags each model accepts come from that output, never from memory.
3. Choose the input shape from the brief: \`--prompt\` for text-to-3D, \`--input-image <path>\` for image-to-3D, and \`--input '<JSON>'\` from \`## Model parameters\` on every call. The rig reference render is a style target only; it is not an input image unless the brief says so.
4. Dry run the exact command shape you will use (\`--prompt\` or \`--input-image\`) first: \`chatroom generate-3d --platform=fal --model <Model> --prompt "<prompt>" --out <Output location>/<ascii-name>.glb --input '<JSON>' --dry-run\`. Apply every constraint it prints and never add a parameter it reports as unsupported. The default model is \`fal-ai/trellis-2\`: a prompt on it generates a 1024x1024 reference image with FLUX 2 Flash first, and that image ships in the package.
5. Real run only in the shape the dry run validated: \`chatroom generate-3d --platform=fal --model <Model> --prompt "<prompt>" --out <Output location>/<ascii-name>.glb --input '<JSON>'\`. Pass \`--confirm-cost\` only when \`## Cost confirmation\` quotes the user's approval of that priced plan; otherwise return the priced plan and stop.
6. Pass \`--rig\` and \`--animation-action-id\` only for \`meshy/v7.1\` models, only when the brief asks for rigging or animation, and only after the user confirms the priced dry run. Rigging expects a humanoid mesh and is verified only for Meshy GLBs.
7. Read the package, do not assume it. A run writes \`<base>.zip\` holding \`<stem>.glb\`, \`web/<stem>.web.glb\`, \`manifest.json\`, the reference image under \`reference/...\` when one was generated or supplied, and the rigged and animation GLBs with their web versions when rigging ran. It also writes \`<base>.html\`, a standalone preview of the high-resolution master and the scaled-down web variant. \`<base>\` is the \`--out\` stem plus the run's UTC timestamp, and \`--package-dir <dir>\` (default: the master's directory) moves both.
8. Measure the exported master GLB before recording it: for glTF, \`gltf-transform inspect <file>\` lists meshes, primitives, materials, and textures; quote the command's actual output for triangle count, bounds, and scale. Record what the run actually used: the model id, the seed and \`--input\` parameters, the package, master GLB, and manifest paths, and each asset name. A name comes from the file you opened, never from the prompt order.

## Quality checklist — 3D models

Mark each applicable item \`pass\`, \`fail\`, \`n/a\`, or \`not checked\` with its evidence label.

Also apply the role prompt's All assets checklist.

${format3dModelChecklist({
  metalnessLine:
    'Metalness follows the lighting contract: with no environment map, the written material is not whole-surface metal (metallic 0 across the surface; metal has no diffuse response and renders near-black). \`generate-3d\` reports a whole-surface metal material as the \`metal-whole-texture\` warning; if it remains after one regeneration, report it under Open questions.',
})}

## Lighting contract

- The \`<base>.html\` preview's Directional and Unlit modes are the game case, but no allowed tool captures those views, so mark that preview inspection \`not checked\` with the reason "no allowed capture tool". Studio mode is image-based lighting and is never lighting evidence.
- For a 3D set, generate the first approved asset's reference and reuse its palette and lighting words for the rest.

## Proof of Principles

Append these lines to the report's Proof of Principles when this skill is used:

- \`chatroom generate-3d --help\` before the first use of the generator; the ids and flags come from that output, never from memory.
- A dry run of each command shape (\`--prompt\` or \`--input-image\`) before its first real call.
- The package the run writes, quoted with its actual file names and paths.
- \`gltf-transform inspect <file>\` for every glTF measurement, quoting the command's output.
`,
};
