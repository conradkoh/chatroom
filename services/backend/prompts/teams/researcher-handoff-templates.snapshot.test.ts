import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the researcher. */
const researcherPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
].filter((pair) => pair.fromRole === 'researcher' || pair.toRole === 'researcher');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const briefHeadings = [
  '## Summary',
  '## Research questions',
  '## Answers',
  '## Repository evidence',
  '## External sources',
  '## Grounded facts for the plan',
  '## Remaining ambiguity',
  '## Risks and constraints',
  '## Work completed',
];

describe('researcher handoff template snapshots', () => {
  test.each(researcherPairs)(
    '$teamId $fromRole → $toRole renders the complete contract',
    (pair) => {
      expect(renderPair(pair)).toMatchSnapshot();
    }
  );

  test('planner delegation states the research trigger and report-only scope', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'planner', toRole: 'researcher' });

    expect(template).toContain(
      'The automatically injected `<user-message>` is the authoritative request'
    );
    expect(template).toContain('### When to research');
    expect(template).toContain('a new library, API, external service');
    expect(template).toContain('an unfamiliar subsystem');
    expect(template).toContain(
      'several plausible approaches that depends on facts not yet in the repository'
    );
    expect(template).toContain('Skip research when the change is a small, well-understood edit');
    expect(template).toContain('report only');
    expect(template).toContain('do not edit files');
    expect(template).toContain('next-role="researcher"');
  });

  test('researcher brief uses the required sections in order and ends with a handoff', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'researcher', toRole: 'planner' });
    const positions = briefHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('next-role="planner"');
  });

  test('researcher brief separates confirmed, inferred, and unknown findings', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'researcher', toRole: 'planner' });

    expect(template).toContain('`confirmed` (with evidence)');
    expect(template).toContain('`inferred` (with reasoning)');
    expect(template).toContain('`unknown`');
    expect(template).toContain('URL, version or date checked');
    expect(template).toContain('`None consulted.`');
    expect(template).toContain('`None observed.`');
    expect(template).toContain('do not edit files, implement code');
    expect(template).toContain('present alternative architectures');
  });
});
