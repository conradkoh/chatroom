import { describe, expect, test } from 'vitest';

import { getArchitectGuidance } from './architect';

describe('architect guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
    ['CLI solo', { nativeIntegration: false, recipientRole: 'solo' }],
    ['native solo', { nativeIntegration: true, recipientRole: 'solo' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getArchitectGuidance(params);

    expect(guidance).toMatchSnapshot();
  });
});
