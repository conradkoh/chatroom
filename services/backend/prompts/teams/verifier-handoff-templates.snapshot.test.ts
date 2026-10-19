import { describe, expect, test } from 'vitest';

import { VERIFIER_VERDICTS } from './verifier-handoff-templates';
import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the verifier. */
const verifierPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
].filter((pair) => pair.fromRole === 'verifier' || pair.toRole === 'verifier');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const requestHeadings = [
  '## Round',
  '## Mode',
  '## User message id',
  '## Context id',
  '## Requested test runs',
  '## Claimed outcome',
  '## Evidence pointers',
  '## Known gaps',
];

const verdictHeadings = [
  '## Verdict',
  '## Objective',
  '## Requirements',
  '## User Expectations',
  '## Evidence',
  '## Missing or unmet',
  '## Scope and limits',
];

describe('verifier handoff template snapshots', () => {
  test.each(verifierPairs)('$teamId $fromRole → $toRole renders the complete contract', (pair) => {
    expect(renderPair(pair)).toMatchSnapshot();
  });

  test('planner request states the logs-only scope, claim-is-not-evidence, and code-change rule', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'planner', toRole: 'verifier' });

    expect(template).toContain('from chatroom logs only');
    expect(template).toContain('Requested test runs');
    expect(template).toContain('runs no test the user did not ask for');
    expect(template).toContain('a claim, not as evidence');
    expect(template).toContain(
      'only when the task involved code changes, in any conversation mode'
    );
    expect(template).not.toContain('never in `chat` mode');
    expect(template).toContain('<chat | code | code:enhanced>');
    expect(template).toContain('The verdict returns to `planner`');
    expect(template).toContain('next-role="verifier"');
  });

  test('planner request uses the required sections in order', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'planner', toRole: 'verifier' });
    const positions = requestHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('verdict uses the required sections in order and ends with a handoff', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'verifier', toRole: 'planner' });
    const positions = verdictHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('next-role="planner"');
  });

  test('verdict enumerates every VERIFIER_VERDICTS token and states the logs-only limit', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'verifier', toRole: 'planner' });

    for (const verdict of VERIFIER_VERDICTS) expect(template).toContain(verdict);
    expect(template).toContain(VERIFIER_VERDICTS.join(', '));
    expect(template).toContain('No tests were run; none were requested.');
  });

  test('verdict carries the user-expectations section and its chat-mode fallback', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'verifier', toRole: 'planner' });

    expect(template).toContain('None applicable.');
    expect(template).toContain('U1');
  });
});
