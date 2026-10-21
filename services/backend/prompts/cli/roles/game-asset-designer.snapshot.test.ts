import { describe, expect, test } from 'vitest';

import { getGameAssetDesignerGuidance } from './game-asset-designer';

describe('game asset designer guidance snapshots', () => {
  test.each([
    ['CLI planner', { nativeIntegration: false, recipientRole: 'planner' }],
    ['native planner', { nativeIntegration: true, recipientRole: 'planner' }],
  ] as const)('%s renders the complete operating model', (_variant, params) => {
    const guidance = getGameAssetDesignerGuidance(params);

    expect(guidance).toMatchSnapshot();
  });

  test('hands off to the concrete recipient and labels evidence', () => {
    const guidance = getGameAssetDesignerGuidance({
      nativeIntegration: false,
      recipientRole: 'Planner',
    });

    expect(guidance).toContain('--role="game-asset-designer" --next-role="planner"');
    expect(guidance).toContain('`measured`');
    expect(guidance).toContain('`inspected`');
    expect(guidance).toContain('`specified`');
    expect(guidance).toContain('`unverified`');
    expect(guidance).not.toContain('{ENTRY_POINT_ROLE}');
    expect(guidance).not.toContain('{SESSION_CONTINUITY}');
  });
});
