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
});

describe('game-asset skill prompts', () => {
  it.each(NEW_SKILLS)('$id returns a prompt with the activation header', ({ id, module }) => {
    const prompt = module.getPrompt('');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.startsWith(`You have been activated with the "${id}" skill.`)).toBe(true);
  });

  it('3D AI prompt anchors the generate-3d command and its dry run', () => {
    const prompt = gameAsset3dAiSkill.getPrompt('');
    expect(prompt).toContain('chatroom generate-3d --platform=fal');
    expect(prompt).toContain('--dry-run');
    expect(prompt).toContain('--confirm-cost');
    expect(prompt).toContain('fal-ai/trellis-2');
    expect(prompt).toContain('metal-whole-texture');
    expect(prompt).toContain('asset-in-rig render');
  });

  it('2D AI prompt anchors the generate-image and slice-image commands', () => {
    const prompt = gameAsset2dAiSkill.getPrompt('');
    expect(prompt).toContain('chatroom generate-image --platform=fal');
    expect(prompt).toContain('chatroom slice-image');
    expect(prompt).toContain('remove-image-background');
    expect(prompt).toContain('Perspective consistency');
    expect(prompt).toContain('Lighting and palette anchor');
  });

  it('procedural prompt anchors the measured inspection and forbids remote generators', () => {
    const prompt = gameAsset3dProceduralSkill.getPrompt('');
    expect(prompt).toContain('gltf-transform inspect');
    expect(prompt).toContain('no `chatroom generate-3d`');
    expect(prompt).toContain('No fal call');
    expect(prompt).toContain('GLB');
  });
});
