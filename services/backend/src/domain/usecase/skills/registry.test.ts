import { describe, expect, test } from 'vitest';

import { SKILLS_REGISTRY } from './registry';

describe('SKILLS_REGISTRY', () => {
  test.each(SKILLS_REGISTRY.map((s) => [s.skillId, s] as const))(
    '%s description is an activation trigger',
    (_skillId, skill) => {
      expect(skill.description).toMatch(/^Use (when|for|this skill when)\b/);
    }
  );

  test('skill ids are unique', () => {
    const ids = SKILLS_REGISTRY.map((s) => s.skillId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(SKILLS_REGISTRY.map((s) => [s.skillId, s] as const))(
    '%s prompt opens with its activation header',
    (skillId, skill) => {
      expect(skill.getPrompt({ cliEnvPrefix: '' })).toMatch(
        new RegExp(`^You have been activated with the "${skillId}" skill\\.`)
      );
    }
  );
});
