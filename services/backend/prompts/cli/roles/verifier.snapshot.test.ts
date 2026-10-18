import { describe, expect, test } from 'vitest';

import { getVerifierGuidance } from './verifier';

describe('verifier guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, entryPointRole: 'planner' }],
    ['native planner', { nativeIntegration: true, entryPointRole: 'planner' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getVerifierGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('is advisory and hands off to the configured entry point', () => {
    const guidance = getVerifierGuidance({ nativeIntegration: false, entryPointRole: 'Planner' });

    expect(guidance).toContain("main job is to check whether the user's goal was accomplished");
    expect(guidance).toContain('judged from chatroom logs');
    expect(guidance).toContain('advisory and read-only');
    expect(guidance).toContain('do not edit files, implement code');
    expect(guidance).toContain('Run no test the user did not ask for');
    expect(guidance).toContain('`chatroom context new`');
    expect(guidance).toContain('--role="verifier" --next-role="planner"');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });

  test('carries the user handoff template and the step 4a expectation rule', () => {
    const guidance = getVerifierGuidance({ nativeIntegration: false, entryPointRole: 'planner' });

    expect(guidance).toContain("## The User's Handoff Template");
    expect(guidance).toContain('Code Change Verification');
    expect(guidance).toContain('Instructions (not part of the message): chat response');
    expect(guidance).toContain('4a. User expectations');
  });
});
