/**
 * handoff view-template — optional CLI recovery command (not used on native delivery).
 *
 * Native delivery inlines templates eagerly; view-template remains for manual
 * reload. See native-workflow-disclosure.test.ts for delivery behavior.
 */

import { describe, expect, test } from 'vitest';

import { viewHandoffTemplate } from '../../../prompts/cli/handoff/view-template';
import { HandoffTemplatePairError } from '../../../prompts/cli/handoff-templates/pair';

describe('handoff view-template command (recovery / CLI)', () => {
  test.each([
    ['duo', 'architect', 'planner'],
    ['duo', 'uiux-engineer', 'planner'],
    ['solo', 'architect', 'solo'],
    ['solo', 'uiux-engineer', 'solo'],
  ] as const)('keeps the concrete %s handoff target for %s', (teamId, from, to) => {
    const template = viewHandoffTemplate({ from, to, teamId });

    expect(template).toContain(`--next-role="${to}"`);
  });

  test('resolves duo planner → user report template body', () => {
    const template = viewHandoffTemplate({ from: 'planner', to: 'user', teamId: 'duo' });
    expect(template).toContain('Planner → User report');
  });

  test('resolves duo builder → planner handoff template body', () => {
    const template = viewHandoffTemplate({ from: 'builder', to: 'planner', teamId: 'duo' });
    expect(template).toContain('Builder → Planner report');
  });

  test('requires both --from and --to', () => {
    expect(() => viewHandoffTemplate({ from: 'planner', teamId: 'duo' })).toThrow(
      /requires both --from and --to \(missing: --to\)/
    );
  });

  test('rejects role-only viewing with LEGACY_ROLE_FLAGS', () => {
    try {
      viewHandoffTemplate({ legacyRole: 'builder', legacyNextRole: 'planner', teamId: 'duo' });
      throw new Error('expected HandoffTemplatePairError');
    } catch (error) {
      expect(error).toBeInstanceOf(HandoffTemplatePairError);
      expect((error as HandoffTemplatePairError).code).toBe('LEGACY_ROLE_FLAGS');
      expect((error as Error).message).toContain(
        'Use: chatroom handoff view-template --from="builder" --to="planner" --team-id="duo"'
      );
    }
  });

  test('rejects a pair that has no template', () => {
    try {
      viewHandoffTemplate({ from: 'planner', to: 'solo', teamId: 'duo' });
      throw new Error('expected HandoffTemplatePairError');
    } catch (error) {
      expect(error).toBeInstanceOf(HandoffTemplatePairError);
      expect((error as HandoffTemplatePairError).code).toBe('UNKNOWN_PAIR');
    }
  });
});
