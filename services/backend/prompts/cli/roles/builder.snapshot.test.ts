import { describe, expect, test } from 'vitest';

import { getBuilderGuidance } from './builder';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('builder guidance snapshots', () => {
  test.each([
    ['CLI', { nativeIntegration: false }],
    ['native', { nativeIntegration: true }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      codeChangesTarget: 'planner',
      questionTarget: 'planner',
      nativeIntegration: params.nativeIntegration,
    });

    expect(guidance).toMatchSnapshot();
  });
});
