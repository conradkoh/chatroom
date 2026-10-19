import { describe, expect, test } from 'vitest';

import { getBaseRoleGuidanceFromContext } from './fromContext';
import type { SelectorContext } from '../../types/sections';

/**
 * A specialist context whose `teamConfig.entryPoint` is deliberately different
 * from the team contract's recipient, so a test can prove which one wins.
 */
function architectContext(
  team: SelectorContext['team'],
  roles: string[],
  entryPoint: string
): SelectorContext {
  return {
    role: 'architect',
    team,
    teamConfig: { id: team, name: `${team} team`, roles, entryPoint },
    teamRoles: roles,
    isEntryPoint: false,
    convexUrl: 'http://127.0.0.1:3210',
    agentType: 'unset',
  };
}

describe('base role guidance recipient resolution', () => {
  test.each([
    ['duo', ['planner', 'builder'], 'planner'],
    ['solo', ['solo'], 'solo'],
  ] as const)(
    '%s architect recipient comes from the team contract, not teamConfig.entryPoint',
    (team, roles, expectedRecipient) => {
      const guidance = getBaseRoleGuidanceFromContext(
        architectContext(team, [...roles], 'builder')
      );

      expect(guidance).toContain(`--role="architect" --next-role="${expectedRecipient}"`);
      expect(guidance).toContain(`Hand the complete design brief to \`${expectedRecipient}\``);
      expect(guidance).not.toContain('--next-role="builder"');
    }
  );

  test('custom team falls back to teamConfig.entryPoint', () => {
    const guidance = getBaseRoleGuidanceFromContext(
      architectContext('unknown', ['lead', 'architect'], 'lead')
    );

    expect(guidance).toContain('--role="architect" --next-role="lead"');
    expect(guidance).toContain('Hand the complete design brief to `lead`');
  });
});
