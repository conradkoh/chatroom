import { describe, expect, test } from 'vitest';

import { getUiuxEngineerGuidance } from './uiux-engineer';

describe('UI/UX engineer guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
    ['CLI solo', { nativeIntegration: false, recipientRole: 'solo' }],
    ['native solo', { nativeIntegration: true, recipientRole: 'solo' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getUiuxEngineerGuidance(params);

    expect(guidance).toMatchSnapshot();
  });
});
