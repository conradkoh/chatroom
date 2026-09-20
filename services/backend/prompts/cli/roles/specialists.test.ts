import { describe, expect, test } from 'vitest';

import { getRoleSpecificGuidance } from './index';
import { getSpecialistGuidance } from './specialists';

describe('specialist role guidance', () => {
  test('architect guidance is a coding design brief', () => {
    const guidance = getSpecialistGuidance({ role: 'architect', nativeIntegration: false });

    expect(guidance).toContain('## Architect Operating Model');
    expect(guidance).toMatch(/module boundaries/i);
    expect(guidance).toMatch(/APIs/);
    expect(guidance).toMatch(/schemas/);
    expect(guidance).toMatch(/queries/);
    expect(guidance).toMatch(/invariants/);
    expect(guidance).toMatch(/failure/);
    expect(guidance).toMatch(/tests/);
    expect(guidance).toMatch(/implementation.*verification sequence/i);
    expect(guidance).toContain('--next-role="planner"');
    expect(guidance).toMatch(/do not implement/i);
    expect(guidance).toContain('get-next-task');
  });

  test('uiux-engineer guidance is an interface and experience design brief', () => {
    const guidance = getSpecialistGuidance({ role: 'uiux-engineer', nativeIntegration: false });

    expect(guidance).toContain('## UI/UX Engineer Operating Model');
    expect(guidance).toMatch(/UI patterns/);
    expect(guidance).toMatch(/components/);
    expect(guidance).toMatch(/tokens/);
    expect(guidance).toMatch(/user flows/);
    expect(guidance).toMatch(/loading, empty, error, and success states/);
    expect(guidance).toMatch(/accessibility/);
    expect(guidance).toMatch(/keyboard/);
    expect(guidance).toMatch(/responsive/);
    expect(guidance).toMatch(/theme-aware/);
    expect(guidance).toMatch(/state ownership/);
    expect(guidance).toMatch(/test plan/);
    expect(guidance).toContain('--next-role="planner"');
    expect(guidance).toMatch(/do not implement/i);
    expect(guidance).toContain('get-next-task');
  });

  test('specialist outputs are distinct and do not use enhancer-only markers', () => {
    const architect = getSpecialistGuidance({ role: 'architect' });
    const uiuxEngineer = getSpecialistGuidance({ role: 'uiux-engineer' });

    expect(architect).not.toBe(uiuxEngineer);
    expect(architect).toContain('schemas');
    expect(architect).not.toContain('CHATROOM_ENHANCER_END');
    expect(uiuxEngineer).toContain('accessibility');
    expect(uiuxEngineer).not.toContain('CHATROOM_ENHANCER_END');
  });

  test('native guidance omits CLI session continuation', () => {
    for (const role of ['architect', 'uiux-engineer']) {
      const guidance = getSpecialistGuidance({ role, nativeIntegration: true });

      expect(guidance).not.toContain('get-next-task');
      expect(guidance).toContain('--next-role="planner"');
    }
  });

  test('specialist guidance targets the configured solo entry point', () => {
    expect(getSpecialistGuidance({ role: 'architect', entryPointRole: 'solo' })).toContain(
      '--next-role="solo"'
    );
    expect(getSpecialistGuidance({ role: 'uiux-engineer', entryPointRole: 'SOLO' })).toContain(
      '--next-role="solo"'
    );
  });

  test('unknown roles return no specialist guidance', () => {
    expect(getSpecialistGuidance({ role: 'tester' })).toBe('');
  });

  test('legacy role guidance exposes both specialist roles', () => {
    expect(getRoleSpecificGuidance('architect', ['architect'], true, '')).toContain(
      '## Architect Operating Model'
    );
    expect(getRoleSpecificGuidance('uiux-engineer', ['uiux-engineer'], true, '')).toContain(
      '## UI/UX Engineer Operating Model'
    );
  });
});
