import { describe, expect, test } from 'vitest';

import { getUiuxEngineerGuidance } from './uiux-engineer';

const removedRoleLabel = ['spec', 'ialist'].join('');

describe('UI/UX engineer guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, entryPointRole: 'planner' }],
    ['native planner', { nativeIntegration: true, entryPointRole: 'planner' }],
    ['CLI solo', { nativeIntegration: false, entryPointRole: 'solo' }],
    ['native solo', { nativeIntegration: true, entryPointRole: 'solo' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getUiuxEngineerGuidance(params);

    expect(guidance).not.toContain(removedRoleLabel);
    expect(guidance).toMatchSnapshot();
  });
});
