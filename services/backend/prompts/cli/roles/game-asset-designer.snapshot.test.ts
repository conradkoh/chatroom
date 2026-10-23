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
    expect(guidance).toContain('Proof of Principles');
    expect(guidance).toContain('Proof of Completion');
    expect(guidance).toContain('P8');
    expect(guidance).toContain('remove-image-background --help');
    expect(guidance).toContain('R9');
    expect(guidance).toContain('--trim');
    expect(guidance).toContain(
      'remove-image-background --in-dir <tiles> --out-dir <Output location> --map <stem>=<name>,... --trim'
    );
    expect(guidance).toContain('--out <Output location>/<name>.png --trim');
    expect(guidance).toContain('2x2');
    expect(guidance).not.toMatch(/fal-ai\/flux-2(?!\/flash)/);

    const procedure = guidance.slice(
      guidance.indexOf('### PROCEDURE'),
      guidance.indexOf('### Quality checklist')
    );
    expect(procedure.length).toBeLessThanOrEqual(2000);
  });
});
