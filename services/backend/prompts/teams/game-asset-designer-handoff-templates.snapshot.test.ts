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
  '## Free asset decisions',
  '## Asset manifest',
  '## Quality checklist results',
  '## Style consistency',
  '## Lighting verification',
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

  test('brief and report use proof blocks, a sheet grid, and only FLUX 2 Flash model ids', () => {
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
    expect(brief).toContain('## Model');
    expect(brief).toContain('## Model parameters');
    expect(brief).toContain('fal-ai/flux-2/flash');
    expect(brief).not.toContain('default model');
    expect(brief).toContain('chatroom generate-3d --help');
    expect(brief).toContain('(dry run first)');
    expect(brief).toContain('procedural: <generator script path>');
    expect(brief).toContain('Procedural 3D:');
    expect(brief).toContain('gltf-transform inspect');
    expect(brief).not.toContain('any other tools you explicitly allow');
    expect(report).toContain('grid values when a sheet was generated');
    expect(report).toContain('For an AI-generated 3D asset also record the preview inspection');
    expect(`${brief}\n${report}`).not.toMatch(/fal-ai\/flux-2(?!\/flash)/);
    expect(`${brief}\n${report}`).not.toMatch(/FLUX\.2|FLUX 2(?! Flash)/);
  });

  test('brief keeps one fixed tool line per domain and covers every skill tool', () => {
    const brief = renderPair({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'game-asset-designer',
    });

    expect(brief).toContain('keep the fixed line for each domain the brief contains');
    expect(brief).toContain(
      'keep the line for each domain the brief contains and delete the others; `None.` for `spec only`'
    );
    expect(brief).toContain('For a mixed brief, give one line per domain prefixed');
    expect(brief.split('For a mixed brief, give one line per domain prefixed')).toHaveLength(3);
    expect(brief).toContain(
      'AI 3D: `chatroom generate-3d --platform=fal --model <Model> (dry run first), gltf-transform inspect`'
    );
    expect(brief).toContain(
      'Procedural 3D: `<generator script path> <run command>, git rev-parse HEAD, gltf-transform inspect`'
    );
    expect(brief).toContain(
      '`Not applicable.` for a procedural asset (its parameters live in the config file named in `## Allowed edit paths`)'
    );
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
    expect(template).toContain('## Lighting contract');
    expect(template).toContain('`Not specified.` is not allowed');
    expect(template).toContain('Unknown: designer to read <path>');
    expect(template).toContain(
      'do not author prompts, material treatment, style, or lighting art direction'
    );
    expect(template).toContain('## Perspective');
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
    expect(template).toContain('## Lighting verification');
    expect(template).toContain('`Delivered, lighting not verified:`');
    expect(template).toContain(
      "Lighting verified under the brief's Lighting contract with an **asset-in-rig render**"
    );
    expect(template).toContain('otherwise the Summary starts `Delivered, lighting not verified:`.');
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
