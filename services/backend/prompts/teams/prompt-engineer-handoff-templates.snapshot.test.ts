import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the prompt engineer. */
const promptEngineerPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
  ...listHandoffTemplatePairs('trio'),
].filter((pair) => pair.fromRole === 'prompt-engineer' || pair.toRole === 'prompt-engineer');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const briefHeadings = [
  '## Summary',
  '## Roles and responsibilities',
  '## Cross-role interactions',
  '## Handoff context audit',
  '## Prompt surfaces affected',
  '## Proposed text',
  '## Structured handoff updates',
  '## Audit test',
  '## Cross-team effect',
  '## Snapshots and guards affected',
  '## Acceptance criteria',
  '## Open questions',
  '## Work completed',
];

describe('prompt-engineer handoff template snapshots', () => {
  test.each(promptEngineerPairs)(
    '$teamId $fromRole → $toRole renders the complete contract',
    (pair) => {
      expect(renderPair(pair)).toMatchSnapshot();
    }
  );

  test('planner delegation states the prompt-engineer trigger and advisory scope', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'planner', toRole: 'prompt-engineer' });

    expect(template).toContain('### When to use the prompt engineer');
    expect(template).toContain('prompt-change brief only');
    expect(template).toContain('do not edit files');
    expect(template).toContain('`architect` designs that first');
    expect(template).toContain('next-role="prompt-engineer"');
  });

  test('prompt-engineer brief uses the required sections in order and ends with a handoff', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'prompt-engineer', toRole: 'planner' });
    const positions = briefHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template).toContain('No change proposed.');
    expect(template).toContain('None observed.');
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('next-role="planner"');
  });

  test('brief requires the multi-role maps, structured handoff updates, and audit test', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'prompt-engineer', toRole: 'planner' });

    expect(template).toContain('## Roles and responsibilities');
    expect(template).toContain('## Cross-role interactions');
    expect(template).toContain('## Handoff context audit');
    expect(template).toContain('## Structured handoff updates');
    expect(template).toContain('## Audit test');
    expect(template).toContain('None required.');
    expect(template).not.toMatch(/memory\/|docs\/|apps\/|services\/|packages\//);
  });

  test('trio prompt-engineer brief returns to the coordinator without plan publishing', () => {
    const template = renderPair({
      teamId: 'trio',
      fromRole: 'prompt-engineer',
      toRole: 'coordinator',
    });

    expect(template).toContain('next-role="coordinator"');
    expect(template).not.toContain('plan publish');
  });

  test('codes the cross-role no-op for a change with no role boundary', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'prompt-engineer', toRole: 'planner' });
    const start = template.indexOf('## Cross-role interactions');
    const end = template.indexOf('## Prompt surfaces affected');
    const section = template.slice(start, end);

    expect(section).toContain(
      'write exactly `None observed.` when the change crosses no role boundary'
    );
  });
});
