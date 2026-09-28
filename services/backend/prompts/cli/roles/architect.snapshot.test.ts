import { describe, expect, test } from 'vitest';

import { getArchitectGuidance } from './architect';

describe('architect guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, entryPointRole: 'planner' }],
    ['native planner', { nativeIntegration: true, entryPointRole: 'planner' }],
    ['CLI solo', { nativeIntegration: false, entryPointRole: 'solo' }],
    ['native solo', { nativeIntegration: true, entryPointRole: 'solo' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getArchitectGuidance(params);

    expect(guidance).toMatchSnapshot();
  });
});
