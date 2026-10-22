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
  '## Target and assumptions',
  '## Asset manifest',
  '## Quality checklist results',
  '## Acceptance criteria results',
  '## Style consistency',
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
    expect(template).toContain('## Spec consumer');
    expect(template).toContain('## Existing assets');
    expect(template).toContain('## Deliverable mode');
    expect(template).toContain('## Allowed tools');
    expect(template).toContain('## Allowed edit paths');
    expect(template).toContain('## Commit');
    expect(template).toContain('## Output location');
    expect(template).toContain('## Acceptance criteria');
    expect(template).toContain('Instructions (not part of the message):');
    expect(template).toContain('Instructions after the body (not part of the message):');
    expect(template).toContain('### When to use the game asset designer');
    expect(template).toContain('spec only');
    expect(template).toContain('spec and generate');
    expect(template).toContain('next-role="game-asset-designer"');
    expect(template.indexOf('## Acceptance criteria')).toBeLessThan(
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
