import { describe, expect, test } from 'vitest';

import { getPromptEngineerGuidance } from './prompt-engineer';

describe('prompt-engineer guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
    ['native coordinator', { nativeIntegration: true, recipientRole: 'coordinator' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getPromptEngineerGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('is advisory and hands off to the concrete recipient', () => {
    const guidance = getPromptEngineerGuidance({
      nativeIntegration: false,
      recipientRole: 'Planner',
    });

    expect(guidance).toContain('advisory only');
    expect(guidance).toContain(
      'do not edit files, run builds, tests, or snapshot updates, publish plans'
    );
    expect(guidance).toContain('--role="prompt-engineer" --next-role="planner"');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });

  test('encodes the multi-role and single-prompt success factors without repo-specific paths', () => {
    const guidance = getPromptEngineerGuidance({
      nativeIntegration: false,
      recipientRole: 'planner',
    });

    for (const phrase of [
      'Inventory the roles the change touches',
      'Map the high-level cross-role interactions',
      'Audit the handoff context',
      'structured information handoffs',
      'Name the audit test that encodes the cross-role script',
      'keep the prompt concise',
      'positive, specific instruction',
      'strict must-avoid case',
    ]) {
      expect(guidance).toContain(phrase);
    }

    expect(guidance).not.toMatch(/memory\/|docs\/|apps\/|services\/|packages\//);
  });
});
