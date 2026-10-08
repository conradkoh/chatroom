import { describe, expect, test } from 'vitest';

import { getResearcherGuidance } from './researcher';

describe('researcher guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, entryPointRole: 'planner' }],
    ['native planner', { nativeIntegration: true, entryPointRole: 'planner' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getResearcherGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('is advisory and hands off to the configured entry point', () => {
    const guidance = getResearcherGuidance({ nativeIntegration: false, entryPointRole: 'Planner' });

    expect(guidance).toContain('advisory only');
    expect(guidance).toContain('do not edit files, implement code');
    expect(guidance).toContain('--role="researcher" --next-role="planner"');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });
});
