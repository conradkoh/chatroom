import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the reviewer. */
const reviewerPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
].filter((pair) => pair.fromRole === 'reviewer' || pair.toRole === 'reviewer');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const reportHeadings = ['## Summary', '## Review scope', '## Issues', '## Not reviewed'];

describe('reviewer handoff template snapshots', () => {
  test.each(reviewerPairs)('$teamId $fromRole → $toRole renders the complete contract', (pair) => {
    expect(renderPair(pair)).toMatchSnapshot();
  });

  test('planner delegation states the review target, focus, and report-only scope', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'planner', toRole: 'reviewer' });

    expect(template).toContain('commit range, branch, pull request, or file list');
    expect(template).toContain('review focus');
    expect(template).toContain('### When to review');
    expect(template).toContain('a builder slice has just completed');
    expect(template).toContain('the user asks for a code review');
    expect(template).toContain('Skip review for a trivial edit');
    expect(template).toContain('report only');
    expect(template).toContain('do not edit files');
    expect(template).toContain('next-role="reviewer"');
  });

  test('reviewer report uses the required sections in order and ends with a handoff', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'reviewer', toRole: 'planner' });
    const positions = reportHeadings.map((heading) => template.indexOf(`\n${heading}\n`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(template.trimEnd().endsWith('```')).toBe(true);
    expect(template).toContain('next-role="planner"');
  });

  test('reviewer report labels severities and cites file and line', () => {
    const template = renderPair({ teamId: 'duo', fromRole: 'reviewer', toRole: 'planner' });

    expect(template).toContain('`blocker`');
    expect(template).toContain('`major`');
    expect(template).toContain('`minor`');
    expect(template).toContain('`nit`');
    expect(template).toContain('file:line');
    expect(template).toContain('`None observed.`');
    expect(template).toContain('`None.`');
    expect(template).toContain('do not edit files');
    expect(template).toContain('do not edit files, implement fixes');
  });
});
