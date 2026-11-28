import { describe, expect, test } from 'vitest';

import { getBaseRoleGuidanceFromContext } from './fromContext';
import { getRoleSpecificGuidance } from './index';
import { getPromptEngineerGuidance } from './prompt-engineer';
import type { SelectorContext } from '../../types/sections';

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
    const rendered = getPromptEngineerGuidance({
      nativeIntegration: false,
      recipientRole: 'planner',
    });
    const guidance = rendered.toLowerCase();

    for (const phrase of [
      'inventory the roles the change touches',
      'map the high-level cross-role interactions',
      'audit the handoff context',
      'structured information handoffs',
      'name the audit test that encodes the cross-role script',
      'keep the prompt concise',
      'positive, specific instruction',
      'strict must-avoid case',
    ]) {
      expect(guidance).toContain(phrase);
    }

    // The audit-test factor applies only when the change crosses a role boundary.
    expect(guidance).toContain('when the change crosses a role boundary');

    expect(rendered).not.toMatch(/memory\/|docs\/|apps\/|services\/|packages\//);
  });

  test('role dispatch renders the operating model for prompt-engineer', () => {
    const guidance = getRoleSpecificGuidance(
      'prompt-engineer',
      ['prompt-engineer'],
      false,
      'http://127.0.0.1:3210',
      'planner'
    );

    expect(guidance).not.toBe('');
    expect(guidance).toContain('## Prompt Engineer Operating Model');
    expect(guidance).toContain('--next-role="planner"');
  });

  test('from context, hands off to the concrete recipient', () => {
    const ctx: SelectorContext = {
      role: 'prompt-engineer',
      team: 'solo',
      teamConfig: { id: 'solo', name: 'Solo Team', roles: ['solo'], entryPoint: 'solo' },
      teamRoles: ['solo'],
      isEntryPoint: false,
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'unset',
    };

    const guidance = getBaseRoleGuidanceFromContext(ctx);

    expect(guidance).toContain('## Prompt Engineer Operating Model');
    expect(guidance).toContain('--next-role="solo"');
  });
});
