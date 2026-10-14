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

    expect(guidance).toContain('from chatroom logs only');
    expect(guidance).toContain('advisory and read-only');
    expect(guidance).toContain('do not edit files, implement code');
    expect(guidance).toContain('`chatroom context new`');
    expect(guidance).toContain('--role="verifier" --next-role="planner"');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });
});
