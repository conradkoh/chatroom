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

describe('duo planner product-manager activation guidance', () => {
  const guidance = getPlannerGuidance({
    role: 'planner',
    teamRoles: ['planner', 'builder', 'product-manager'],
    isEntryPoint: true,
    convexUrl: CONVEX_URL,
    chatroomId: 'test-chatroom-id',
    nativeIntegration: false,
  });

  test('activates the product manager for new ambiguous features, naming planner as the activator', () => {
    expect(guidance).toContain('**Product manager before scoping a new ambiguous feature:**');
    expect(guidance).toContain('hand off to `product-manager` for a product specification before');
    expect(guidance).toContain('Only the entry point (`planner`) activates it.');
  });

  test('excludes small bug fixes and unambiguous requests, and keeps bug routing to triage', () => {
    expect(guidance).toContain('Skip it for small bug fixes, for unambiguous requests');
    expect(guidance).toContain('**Bug reports go to triage first:**');
  });

  test('places the product-manager gate before the bug-routing gate', () => {
    expect(guidance.indexOf('**Product manager before scoping')).toBeLessThan(
      guidance.indexOf('**Bug reports go to triage first:**')
    );
  });
});
