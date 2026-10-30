import { describe, expect, test } from 'vitest';

import { getPlannerGuidance } from './planner';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('duo planner asset lighting guidance', () => {
  test('requires a lighting contract and gates 3D delivery on it', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      chatroomId: 'test-chatroom-id',
      nativeIntegration: false,
    });

    expect(guidance).toContain('`## Lighting contract`');
    expect(guidance).toContain('lighting cannot be optional');
    expect(guidance).toContain('Lighting gate');
    expect(guidance).toContain(
      'Do not author prompts, material treatment, style or lighting art direction'
    );
  });
});
