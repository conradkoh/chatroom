import { describe, expect, test } from 'vitest';

import {
  VERIFIER_VERDICTS,
  getEntryPointToVerifierHandoffTemplate,
  getVerifierToEntryPointHandoffTemplate,
} from './verifier-handoff-templates';

const requestHeadings = [
  '## Round',
  '## Mode',
  '## User message id',
  '## Context id',
  '## Claimed outcome',
  '## Evidence pointers',
  '## Known gaps',
  '## Handoff',
];

const verdictHeadings = [
  '## Verdict',
  '## Objective',
  '## Requirements',
  '## Evidence',
  '## Missing or unmet',
  '## Scope and limits',
  '## Handoff',
];

describe('verifier handoff template snapshots', () => {
  test.each([
    ['planner request', getEntryPointToVerifierHandoffTemplate('planner')],
    ['verifier to planner', getVerifierToEntryPointHandoffTemplate('planner')],
    ['solo request', getEntryPointToVerifierHandoffTemplate('solo')],
    ['verifier to solo', getVerifierToEntryPointHandoffTemplate('solo')],
  ] as const)('%s renders the complete contract', (_variant, template) => {
    expect(template).toMatchSnapshot();
  });

  test('planner request states the logs-only scope, claim-is-not-evidence, and mode limits', () => {
    const template = getEntryPointToVerifierHandoffTemplate('planner');

    expect(template).toContain('from chatroom logs only');
    expect(template).toContain('executes nothing');
    expect(template).toContain('a claim, not as evidence');
    expect(template).toContain('never in `chat` mode');
    expect(template).toContain('The verdict returns to `planner`');
    expect(template).toContain('next-role="verifier"');
  });

  test('planner request uses the required sections in order', () => {
    const template = getEntryPointToVerifierHandoffTemplate('planner');
    const positions = requestHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('verdict uses the required sections in order and ends with a handoff', () => {
    const template = getVerifierToEntryPointHandoffTemplate('planner');
    const positions = verdictHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('next-role="planner"');
  });

  test('verdict enumerates every VERIFIER_VERDICTS token and states the logs-only limit', () => {
    const template = getVerifierToEntryPointHandoffTemplate('planner');

    for (const verdict of VERIFIER_VERDICTS) expect(template).toContain(verdict);
    expect(template).toContain(VERIFIER_VERDICTS.join(', '));
    expect(template).toContain('No tests, builds, or repository inspection');
  });
});
