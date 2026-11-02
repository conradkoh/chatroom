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

  test('uses the rules/procedure skeleton and the proof report sections', () => {
    const guidance = getGameAssetDesignerGuidance({
      nativeIntegration: false,
      recipientRole: 'planner',
    });

    expect(guidance).toContain('### RULES');
    expect(guidance).toContain('### PROCEDURE');
    expect(guidance).toContain('### Set consistency principles');
    expect(guidance).toContain('`Delivered, lighting not verified:`');
    expect(guidance).toContain(
      '`## Lighting contract` is missing, not specified, or not applicable'
    );
    expect(guidance).toContain('`Not applicable.` only for 2D/audio');
    expect(guidance).not.toContain('negative_prompt');
    expect(guidance).toContain('spec only');
    expect(guidance).toContain('quote the exact error');
    expect(guidance).toContain('Do not install or run any remote tool');
    expect(guidance).toContain('Never switch generators');
    expect(guidance).toContain('production-ready');
    expect(guidance).not.toMatch(/fal-ai\/flux-2(?!\/flash)/);
    expect(guidance).not.toMatch(/FLUX\.2|FLUX 2(?! Flash)/);
    expect(guidance).toContain('Proof of Principles');
    expect(guidance).toContain('Proof of Completion');

    const procedure = guidance.slice(
      guidance.indexOf('### PROCEDURE'),
      guidance.indexOf('### Quality checklist')
    );
    expect(procedure.length).toBeLessThanOrEqual(2300);
  });
});
