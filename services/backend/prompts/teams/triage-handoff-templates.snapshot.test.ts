import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is triage. */
const triagePairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
].filter((pair) => pair.fromRole === 'triage' || pair.toRole === 'triage');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const reportHeadings = [
  '## Summary',
  '## Reported behavior',
  '## Root cause',
  '## Reproduction attempt',
  '## Proposed immediate fix',
  '## Systemic issues',
  '## Work completed',
];

describe('triage handoff template snapshots', () => {
  test.each(triagePairs)('$teamId $fromRole → $toRole renders the complete contract', (pair) => {
    expect(renderPair(pair)).toMatchSnapshot();
  });

  test.each([['planner'], ['solo']] as const)(
    'triage report to %s includes evidence standards and routing',
    (entryPoint) => {
      const teamId = entryPoint === 'planner' ? 'duo' : 'solo';
      const template = renderPair({ teamId, fromRole: 'triage', toRole: entryPoint });

      for (const heading of reportHeadings) expect(template).toContain(heading);
      expect(template).toContain('concrete repository paths and symbols');
      expect(template).toContain('confirmed or a hypothesis');
      expect(template).toContain('exact command');
      expect(template).toContain('exact blocker');
      expect(template).toContain('likely files');
      expect(template).toContain('evidence, impact, and follow-up concern');
      expect(template).toContain('do not edit implementation files');
      expect(template).toContain(`next-role="${entryPoint}"`);
    }
  );

  test.each([['planner'], ['solo']] as const)(
    '%s delegation asks for investigation only',
    (entryPoint) => {
      const teamId = entryPoint === 'planner' ? 'duo' : 'solo';
      const template = renderPair({ teamId, fromRole: entryPoint, toRole: 'triage' });

      expect(template).toContain('reported bug');
      expect(template).toContain('reproduction details');
      expect(template).toContain('relevant constraints');
      expect(template).toContain('must not edit implementation files');
      expect(template).toContain('next-role="triage"');
    }
  );
});
