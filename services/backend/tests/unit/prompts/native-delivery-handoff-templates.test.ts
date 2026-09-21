/**
 * handoff view-template — optional CLI recovery command (not used on native delivery).
 *
 * Native delivery inlines templates eagerly; view-template remains for manual
 * reload. See native-workflow-disclosure.test.ts for delivery behavior.
 */

import { describe, expect, test } from 'vitest';

import { viewHandoffTemplate } from '../../../prompts/cli/handoff/view-template';

describe('handoff view-template command (recovery / CLI)', () => {
  test.each([
    ['architect', /module boundaries|schemas/i],
    ['uiux-engineer', /loading\/empty\/error\/success|accessibility/i],
  ] as const)('renders a generic %s template without an entry-point role', (role, focus) => {
    const template = viewHandoffTemplate({ role });

    expect(template).toMatch(focus);
    expect(template).toContain('<entry-point-role>');
    expect(template).not.toContain('planner');
    expect(template).not.toContain('solo');
  });

  test.each([
    ['duo', 'architect', 'planner'],
    ['duo', 'uiux-engineer', 'planner'],
    ['solo', 'architect', 'solo'],
    ['solo', 'uiux-engineer', 'solo'],
  ] as const)('keeps concrete %s handoff target for %s', (teamId, role, nextRole) => {
    const template = viewHandoffTemplate({ role, nextRole, teamId });

    expect(template).toContain(`--next-role="${nextRole}"`);
  });

  test('resolves duo planner → user report template body', () => {
    const template = viewHandoffTemplate({
      role: 'planner',
      nextRole: 'user',
      teamId: 'duo',
    });
    expect(template).toContain('Report Template (Planner → User)');
  });

  test('resolves duo builder → planner handoff template body', () => {
    const template = viewHandoffTemplate({
      role: 'builder',
      nextRole: 'planner',
      teamId: 'duo',
    });
    expect(template).toContain('Handoff Template (Builder → Planner)');
  });

  test('rejects role-only viewing for non-design roles', () => {
    expect(() => viewHandoffTemplate({ role: 'builder' })).toThrow(
      /only for architect or uiux-engineer/i
    );
  });
});
