import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the game asset designer. */
const gameAssetDesignerPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
].filter(
  (pair) => pair.fromRole === 'game-asset-designer' || pair.toRole === 'game-asset-designer'
);

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const reportHeadings = [
  '## Summary',
  '## Proof of Principles',
  '## Proof of Completion',
  '## Target and assumptions',
  '## Asset manifest',
  '## Quality checklist results',
  '## Style consistency',
  '## Naming map',
  '## Created and edited paths',
  '## Commits',
  '## Sources',
  '## Open questions',
  '## Not verified',
  '## Recommended next step',
];

describe('game asset designer handoff template snapshots', () => {
  test.each(gameAssetDesignerPairs)(
    '$teamId $fromRole → $toRole renders the complete contract',
    (pair) => {
      expect(renderPair(pair)).toMatchSnapshot();
    }
  );

  test('brief and report use proof blocks, a sheet grid, and no flux-2 sheet model', () => {
    const brief = renderPair({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'game-asset-designer',
    });
    const report = renderPair({
      teamId: 'duo',
      fromRole: 'game-asset-designer',
      toRole: 'planner',
    });

    expect(brief).toContain('## Sheet grid');
    expect(brief).toContain('2x2');
    expect(brief).toContain('## Proof of Principles');
    expect(brief).toContain('## Proof of Completion');
    expect(report).toContain('## Proof of Principles');
    expect(report).toContain('## Proof of Completion');
    expect(report).toContain('## Naming map');
    expect(report).toContain('`--input-image`');
    expect(brief).toContain('## Model');
    expect(brief).toContain('## Model parameters');
    expect(brief).toContain('fal-ai/flux-2/flash');
    expect(brief).toContain('Always pass `--trim` to `chatroom remove-image-background`');
    expect(report).toContain('Always pass `--trim` to `chatroom remove-image-background`');
    expect(`${brief}\n${report}`).not.toMatch(/fal-ai\/flux-2(?!\/flash)/);
  });

  test('planner delegation states the target, budgets, style reference, and deliverable mode', () => {
    const template = renderPair({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'game-asset-designer',
    });

    expect(template).toContain('## Asset request');
    expect(template).toContain('## Target');
    expect(template).toContain('## Assets requested');
    expect(template).toContain('## Budgets and conventions');
    expect(template).toContain('## Style reference');
    expect(template).toContain('## Perspective');
    expect(template).toContain('no sheets');
    expect(template).toContain('## Spec consumer');
    expect(template).toContain('## Existing assets');
    expect(template).toContain('## Deliverable mode');
    expect(template).toContain('## Allowed tools');
    expect(template).toContain('## Allowed edit paths');
    expect(template).toContain('## Commit');
    expect(template).toContain('## Output location');
    expect(template).toContain('## Sheet grid');
    expect(template).toContain('## Proof of Principles');
    expect(template).toContain('## Proof of Completion');
    expect(template).toContain('Instructions (not part of the message):');
    expect(template).toContain('Instructions after the body (not part of the message):');
    expect(template).toContain('### When to use the game asset designer');
    expect(template).toContain('spec only');
    expect(template).toContain('spec and generate');
    expect(template).toContain('next-role="game-asset-designer"');
    expect(template.indexOf('## Proof of Completion')).toBeLessThan(
      template.indexOf('Instructions after the body (not part of the message):')
    );
    expect(template.indexOf('### When to use the game asset designer')).toBeGreaterThan(
      template.indexOf('Instructions after the body (not part of the message):')
    );
  });

  test('designer report uses the required sections in order and ends with a handoff', () => {
    const template = renderPair({
      teamId: 'duo',
      fromRole: 'game-asset-designer',
      toRole: 'planner',
    });
    const positions = reportHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('`None failed.`');
    expect(template).toContain('`None.`');
    expect(template).toContain('next-role="planner"');
  });

  test('designer report labels evidence and forbids unestablished claims', () => {
    const template = renderPair({
      teamId: 'duo',
      fromRole: 'game-asset-designer',
      toRole: 'planner',
    });

    expect(template).toContain('`measured`');
    expect(template).toContain('`inspected`');
    expect(template).toContain('`specified`');
    expect(template).toContain('`unverified`');
    expect(template).toContain(
      'Never claim a polycount, texel density, loudness, color space, or visual-quality result'
    );
    expect(template).toContain(
      'Write only under the named output location and the named edit paths'
    );
  });
});
