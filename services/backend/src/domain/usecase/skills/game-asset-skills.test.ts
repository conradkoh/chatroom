/**
 * Game-asset skill modules.
 *
 * Seam: the exported SKILLS_REGISTRY / SKILL_IDS and each module's
 * SkillModule.getPrompt. These tests catch a missing registration, an ID
 * mismatch, an empty or wrongly headed prompt, and a prompt that drops the
 * command anchors the skill is defined by.
 */

import { describe, expect, it } from 'vitest';

import { SKILL_IDS } from '../../types/skills';
import { gameAsset2dAiSkill } from './modules/game-asset-2d-ai/index';
import { gameAsset3dAiSkill } from './modules/game-asset-3d-ai/index';
import { gameAsset3dProceduralSkill } from './modules/game-asset-3d-procedural/index';
import { SKILLS_REGISTRY } from './registry';

const NEW_SKILLS = [
  { id: 'game-asset-3d-ai', module: gameAsset3dAiSkill },
  { id: 'game-asset-2d-ai', module: gameAsset2dAiSkill },
  { id: 'game-asset-3d-procedural', module: gameAsset3dProceduralSkill },
] as const;

describe('game-asset skills registration', () => {
  it.each(NEW_SKILLS)('exposes $id in SKILL_IDS', ({ id }) => {
    expect(SKILL_IDS).toContain(id);
  });

  it.each(NEW_SKILLS)('registers $id once in SKILLS_REGISTRY', ({ id }) => {
    const matches = SKILLS_REGISTRY.filter((skill) => skill.skillId === id);
    expect(matches).toHaveLength(1);
  });

  it('has no duplicate skill IDs in the registry', () => {
    const ids = SKILLS_REGISTRY.map((skill) => skill.skillId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the registry module for every new ID', () => {
    for (const { id, module } of NEW_SKILLS) {
      expect(SKILLS_REGISTRY.find((skill) => skill.skillId === id)).toBe(module);
    }
  });

  it.each(NEW_SKILLS)('$id is scoped to the game asset designer', ({ id, module }) => {
    expect(module.description).toContain('(game-asset-designer only)');
    expect(SKILLS_REGISTRY.find((skill) => skill.skillId === id)?.description).toContain(
      '(game-asset-designer only)'
    );
  });
});

describe('game-asset skill prompts', () => {
  it.each(NEW_SKILLS)('$id returns a prompt with the activation header', ({ id, module }) => {
    const prompt = module.getPrompt('');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.startsWith(`You have been activated with the "${id}" skill.`)).toBe(true);
  });

  it.each(NEW_SKILLS)('$id defers to the shared rules in the role prompt', ({ module }) => {
    const prompt = module.getPrompt('');
    expect(prompt).toContain('shared rules in your role prompt apply');
    expect(prompt).not.toContain('- R1 ');
    expect(prompt).not.toContain('a tool or script you ran on the actual file');
  });

  it('3D AI prompt anchors the generate-3d command and its dry run', () => {
    const prompt = gameAsset3dAiSkill.getPrompt('');
    expect(prompt).toContain('chatroom generate-3d --platform=fal');
    expect(prompt).toContain('--model <Model>');
    expect(prompt).toContain('--dry-run');
    expect(prompt).toContain("--input '<JSON>'");
    expect(prompt).toContain('--confirm-cost');
    expect(prompt).toContain('fal-ai/trellis-2');
    expect(prompt).toContain('metal-whole-texture');
  });

  it('3D AI prompt keeps the lighting contract and its evidence rules', () => {
    const prompt = gameAsset3dAiSkill.getPrompt('');
    expect(prompt).toContain('visible, coloured');
    expect(prompt).toContain("the preview's Directional and Unlit modes are the game case");
    expect(prompt).toContain('Studio mode');
    expect(prompt).toContain('never lighting evidence');
    expect(prompt).toContain('Metalness follows the lighting contract');
  });

  it('3D AI prompt keeps the glTF measurement hint', () => {
    const prompt = gameAsset3dAiSkill.getPrompt('');
    expect(prompt).toContain(
      'Measure the exported master GLB before recording it: for glTF, `gltf-transform inspect <file>` lists meshes'
    );
  });

  it.each(NEW_SKILLS.map(({ id, module }) => [id, module] as const))(
    'ai and procedural prompts: %s references the shared All assets checklist instead of restating it',
    (_id, module) => {
      const prompt = module.getPrompt('');
      expect(prompt).toContain("Also apply the role prompt's All assets checklist.");
      expect(prompt).not.toContain('Naming follows the project convention');
      expect(prompt).not.toContain('Style matches the named style reference');
      expect(prompt).not.toContain('Budgets in the request');
    }
  );

  it.each([
    ['3D AI', gameAsset3dAiSkill],
    ['procedural', gameAsset3dProceduralSkill],
  ] as const)('%s prompt defers the lighting definitions to the role prompt', (_label, module) => {
    const prompt = module.getPrompt('');
    expect(prompt).not.toContain('the existing render of the target rig');
    expect(prompt).not.toContain(
      "a render of the generated asset loaded in the project's real scene"
    );
    expect(prompt).not.toContain('`not checked` blocks delivery');
  });

  it('procedural prompt shares the AI 3D PBR checklist', () => {
    const prompt = gameAsset3dProceduralSkill.getPrompt('');
    expect(prompt).toContain('Verify the slot for each map');
    expect(prompt).toContain('for example Unreal; confirm for the target engine version');
    expect(prompt).toContain('no baked-in lighting or text in base color');
  });

  it('3D prompts backtick the shared lighting headings', () => {
    for (const module of [gameAsset3dAiSkill, gameAsset3dProceduralSkill]) {
      const prompt = module.getPrompt('');
      expect(prompt).toContain("the brief's `## Lighting contract`");
      expect(prompt).toContain('under `## Lighting verification`');
    }
  });

  it('2D AI prompt anchors the generate-image and slice-image commands', () => {
    const prompt = gameAsset2dAiSkill.getPrompt('');
    expect(prompt).toContain('chatroom generate-image --platform=fal');
    expect(prompt).toContain('--model <Model>');
    expect(prompt).toContain("--input '<JSON>'");
    expect(prompt).toContain('chatroom slice-image');
    expect(prompt).toContain('remove-image-background --help');
    expect(prompt).toContain('Perspective consistency');
    expect(prompt).toContain('Lighting and palette anchor');
  });

  it('2D AI prompt keeps the trim, naming, and sheet rules', () => {
    const prompt = gameAsset2dAiSkill.getPrompt('');
    expect(prompt).toContain('Always pass `--trim` to `chatroom remove-image-background`');
    expect(prompt).toContain('use `--trim-padding` only when the brief names a padding');
    expect(prompt).toContain('Never pass `--names` to `slice-image`');
    expect(prompt).toContain(
      '(sheet: `<Output location>/_work/<sheet>.png`; per-asset: the step 4 path)'
    );
    expect(prompt).toContain('ceil(N/(C×R))');
    expect(prompt).toContain(
      "at most the brief's `## Sheet grid` (default 2x2); a larger grid needs a user request quoted in the brief, one asset per cell"
    );
    expect(prompt).toContain('never use a sheet');
    expect(prompt).toContain('A mismatched item is regenerated individually');
    expect(prompt).toContain('as a failed item/open question');
  });

  it('2D AI prompt keeps the perspective and seed wording', () => {
    const prompt = gameAsset2dAiSkill.getPrompt('');
    expect(prompt).toContain('A shared seed does not keep perspective across different prompts');
    expect(prompt).toContain("(the brief's `Perspective`, or the one recorded under assumptions)");
  });

  it('procedural prompt anchors the measured inspection and forbids remote generators', () => {
    const prompt = gameAsset3dProceduralSkill.getPrompt('');
    expect(prompt).toContain('gltf-transform inspect');
    expect(prompt).toContain('no `chatroom generate-3d`');
    expect(prompt).toContain('No fal call');
    expect(prompt).toContain('Export glTF 2.0/GLB to');
  });

  it('procedural prompt keeps one committed-config policy and its lighting item', () => {
    const prompt = gameAsset3dProceduralSkill.getPrompt('');
    expect(prompt).toContain('visible, coloured');
    expect(prompt).toContain('committed only when `## Commit` names it');
    expect(prompt).not.toContain('versioned, committed config');
  });
});
