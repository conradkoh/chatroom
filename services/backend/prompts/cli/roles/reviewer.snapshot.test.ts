import { describe, expect, test } from 'vitest';

import { getReviewerGuidance } from './reviewer';

describe('reviewer guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getReviewerGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('is advisory and hands off to the concrete recipient', () => {
    const guidance = getReviewerGuidance({ nativeIntegration: false, recipientRole: 'Planner' });

    expect(guidance).toContain('advisory only');
    expect(guidance).toContain('do not edit files, implement fixes');
    expect(guidance).toContain('--role="reviewer" --next-role="planner"');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });
});
