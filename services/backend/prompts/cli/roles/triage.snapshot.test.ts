import { describe, expect, test } from 'vitest';

import { getBaseRoleGuidanceFromContext } from './fromContext';
import { getRoleSpecificGuidance } from './index';
import { getTriageGuidance } from './triage';
import type { SelectorContext } from '../../types/sections';

describe('triage guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, entryPointRole: 'planner' }],
    ['native planner', { nativeIntegration: true, entryPointRole: 'planner' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getTriageGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('is advisory and hands off to the configured entry point', () => {
    const guidance = getTriageGuidance({ nativeIntegration: false, entryPointRole: 'Planner' });

    expect(guidance).toContain('advisory only');
    expect(guidance).toContain('do not edit implementation files');
    expect(guidance).toContain('--role="triage" --next-role="planner"');
    expect(guidance).toContain('beginning with the `## Summary` section');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });

  test('role dispatch renders the operating model for triage', () => {
    const guidance = getRoleSpecificGuidance('triage', ['triage'], false, 'http://127.0.0.1:3210');

    expect(guidance).not.toBe('');
    expect(guidance).toContain('## Triage Operating Model');
  });

  test('from context, hands off to the configured entry point', () => {
    const ctx: SelectorContext = {
      role: 'triage',
      team: 'solo',
      teamConfig: { id: 'solo', name: 'Solo Team', roles: ['solo'], entryPoint: 'solo' },
      teamRoles: ['solo'],
      isEntryPoint: false,
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'unset',
    };

    const guidance = getBaseRoleGuidanceFromContext(ctx);

    expect(guidance).toContain('## Triage Operating Model');
    expect(guidance).toContain('--next-role="solo"');
  });
});
