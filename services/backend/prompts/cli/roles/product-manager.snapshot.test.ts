import { describe, expect, test } from 'vitest';

import { getBaseRoleGuidanceFromContext } from './fromContext';
import { getRoleSpecificGuidance } from './index';
import { getProductManagerGuidance } from './product-manager';
import type { SelectorContext } from '../../types/sections';

describe('product-manager guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getProductManagerGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('is advisory and read-only and hands off to the concrete recipient', () => {
    const guidance = getProductManagerGuidance({
      nativeIntegration: false,
      recipientRole: 'Planner',
    });

    expect(guidance).toContain('advisory and read-only');
    expect(guidance).toContain('never edit repository files');
    expect(guidance).toContain('--role="product-manager" --next-role="planner"');
    expect(guidance).toContain('beginning with the `## Summary` section');
    expect(guidance).toContain('existing app behavior');
    expect(guidance).toContain('out of scope');
    expect(guidance).toContain('escalation criteria');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });

  test('decides product decisions itself and escalates only under the criteria', () => {
    const guidance = getProductManagerGuidance({
      nativeIntegration: false,
      recipientRole: 'planner',
    });

    expect(guidance).toContain('Decide each development-scope product decision yourself');
    expect(guidance).toContain('a recommended default and a one-line rationale');
    expect(guidance).toContain('List to the user only items that meet the escalation criteria');
    expect(guidance).toContain(
      'Non-development product questions (copy, pricing, opinions, general product talk)'
    );
    expect(guidance).toContain('return them to `planner`');
    expect(guidance).toContain('scoping coding and development work in this repository');
    expect(guidance).not.toContain('product defaults');
    expect(guidance).not.toMatch(/never list/i);
    expect(guidance).toContain('(a) **ambiguous or insufficient request:**');
    expect(guidance).toContain('(b) **destructive risk:**');
    expect(guidance).not.toContain('belong to the user');
    expect(guidance).not.toContain('List every open question for the user');
    expect(guidance).not.toContain('instead of guessing');
  });

  test('role dispatch renders the operating model for product-manager', () => {
    const guidance = getRoleSpecificGuidance(
      'product-manager',
      ['product-manager'],
      false,
      'http://127.0.0.1:3210',
      'planner'
    );

    expect(guidance).not.toBe('');
    expect(guidance).toContain('## Product Manager Operating Model');
  });

  test('from context, hands off to the concrete recipient', () => {
    const ctx: SelectorContext = {
      role: 'product-manager',
      team: 'solo',
      teamConfig: { id: 'solo', name: 'Solo Team', roles: ['solo'], entryPoint: 'solo' },
      teamRoles: ['solo'],
      isEntryPoint: false,
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'unset',
    };

    const guidance = getBaseRoleGuidanceFromContext(ctx);

    expect(guidance).toContain('## Product Manager Operating Model');
    expect(guidance).toContain('--next-role="solo"');
  });
});
