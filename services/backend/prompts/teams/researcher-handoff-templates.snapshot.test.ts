import { describe, expect, test } from 'vitest';

import {
  getEntryPointToResearcherHandoffTemplate,
  getResearcherToEntryPointHandoffTemplate,
} from './researcher-handoff-templates';

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
  '## Handoff',
];

describe('researcher handoff template snapshots', () => {
  test.each([
    ['planner delegation', getEntryPointToResearcherHandoffTemplate('planner')],
    ['researcher to planner', getResearcherToEntryPointHandoffTemplate('planner')],
  ] as const)('%s renders the complete contract', (_variant, template) => {
    expect(template).toMatchSnapshot();
  });

  test('planner delegation states the research trigger and report-only scope', () => {
    const template = getEntryPointToResearcherHandoffTemplate('planner');

    expect(template).toContain(
      'The automatically injected `<user-message>` is the authoritative request'
    );
    expect(template).toContain('### When to research');
    expect(template).toContain('a new library, API, external service');
    expect(template).toContain('an unfamiliar subsystem');
    expect(template).toContain('several plausible designs');
    expect(template).toContain('Skip research when the change is a small, well-understood edit');
    expect(template).toContain('report only');
    expect(template).toContain('do not edit files');
    expect(template).toContain('next-role="researcher"');
  });

  test('researcher brief uses the required sections in order and ends with a handoff', () => {
    const template = getResearcherToEntryPointHandoffTemplate('planner');
    const positions = briefHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('next-role="planner"');
  });

  test('researcher brief separates confirmed, inferred, and unknown findings', () => {
    const template = getResearcherToEntryPointHandoffTemplate('planner');

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
