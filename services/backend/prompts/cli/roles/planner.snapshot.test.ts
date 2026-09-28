import { describe, expect, test } from 'vitest';

import { getPlannerGuidance } from './planner';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('planner guidance snapshots', () => {
  test.each([
    ['CLI duo', { nativeIntegration: false, teamRoles: ['planner', 'builder'] }],
    ['native duo', { nativeIntegration: true, teamRoles: ['planner', 'builder'] }],
    ['CLI solo', { nativeIntegration: false, teamRoles: ['solo'] }],
    ['native solo', { nativeIntegration: true, teamRoles: ['solo'] }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getPlannerGuidance({
      role: params.teamRoles[0],
      teamRoles: [...params.teamRoles],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      chatroomId: 'test-chatroom-id',
      nativeIntegration: params.nativeIntegration,
    });

    expect(guidance).toMatchSnapshot();
  });
});
