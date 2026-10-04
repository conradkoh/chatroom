import { describe, expect, test } from 'vitest';

import {
  getEntryPointToTriageHandoffTemplate,
  getTriageToEntryPointHandoffTemplate,
} from './triage-handoff-templates';

const reportHeadings = [
  '## Summary',
  '## Reported behavior',
  '## Root cause',
  '## Reproduction attempt',
  '## Proposed immediate fix',
  '## Systemic issues',
  '## Work completed',
  '## Handoff',
];

describe('triage handoff template snapshots', () => {
  test.each([
    ['planner delegation', getEntryPointToTriageHandoffTemplate('planner')],
    ['solo delegation', getEntryPointToTriageHandoffTemplate('solo')],
    ['triage to planner', getTriageToEntryPointHandoffTemplate('planner')],
    ['triage to solo', getTriageToEntryPointHandoffTemplate('solo')],
  ] as const)('%s renders the complete contract', (_variant, template) => {
    expect(template).toMatchSnapshot();
  });

  test.each([
    ['planner', getTriageToEntryPointHandoffTemplate('planner')],
    ['solo', getTriageToEntryPointHandoffTemplate('solo')],
  ] as const)(
    'triage report to %s includes evidence standards and routing',
    (entryPoint, template) => {
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

  test.each([
    ['planner', getEntryPointToTriageHandoffTemplate('planner')],
    ['solo', getEntryPointToTriageHandoffTemplate('solo')],
  ] as const)('%s delegation asks for investigation only', (_entryPoint, template) => {
    expect(template).toContain('reported bug');
    expect(template).toContain('reproduction details');
    expect(template).toContain('relevant constraints');
    expect(template).toContain('must not edit implementation files');
    expect(template).toContain('next-role="triage"');
  });
});
