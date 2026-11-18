import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in any team shape whose sender or recipient is the product manager. */
const productManagerPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
  ...listHandoffTemplatePairs('trio'),
].filter((pair) => pair.fromRole === 'product-manager' || pair.toRole === 'product-manager');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

const reportHeadings = [
  '## Summary',
  '## Problem statement',
  '## User stories',
  '## In scope',
  '## Out of scope',
  '## Consistency with existing functionality',
  '## UI and UX review',
  '## Product decisions made',
  '## Open questions for the user',
];

describe('product manager handoff template snapshots', () => {
  test('covers every activator direction across duo, solo, and trio', () => {
    expect(productManagerPairs).toHaveLength(6);
  });

  test.each(productManagerPairs)(
    '$teamId $fromRole → $toRole renders the complete contract',
    (pair) => {
      expect(renderPair(pair)).toMatchSnapshot();
    }
  );

  test.each([
    ['duo', 'planner'],
    ['solo', 'solo'],
    ['trio', 'coordinator'],
  ] as const)(
    'product manager report to %s %s includes the report sections in order and routing',
    (teamId, entryPoint) => {
      const template = renderPair({ teamId, fromRole: 'product-manager', toRole: entryPoint });
      // Match section headings as whole lines: section bodies may reference another heading name inline.
      const headingLines = template.split('\n').filter((line) => line.startsWith('## '));

      let previousIndex = -1;
      for (const heading of reportHeadings) {
        const index = headingLines.indexOf(heading);
        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }
      expect(template).toContain('read-only');
      expect(template).toContain(`next-role="${entryPoint}"`);
    }
  );

  test.each([
    ['duo', 'planner'],
    ['solo', 'solo'],
    ['trio', 'coordinator'],
  ] as const)('%s %s report reserves open questions for escalation items', (teamId, entryPoint) => {
    const template = renderPair({ teamId, fromRole: 'product-manager', toRole: entryPoint });
    const openQuestions = template.slice(template.indexOf('## Open questions for the user'));

    expect(template).toContain('## Product decisions made');
    expect(template).toContain('development-scope product decision');
    expect(template).toContain(
      'return non-development product questions (copy, pricing, opinions, general product talk)'
    );
    expect(template).not.toContain('product defaults');
    expect(template).toContain('the recommended default you chose, and a one-line rationale');
    expect(openQuestions).toContain('only items that meet the escalation criteria');
    expect(openQuestions).toContain('(b) the decision involves deletion, data loss');
    expect(openQuestions).toContain('`None observed.`');
    expect(template).not.toContain('mark each conflict as a decision for the user');
    expect(template).not.toContain('List open questions instead of guessing');
  });

  test.each([
    ['duo', 'planner'],
    ['solo', 'solo'],
    ['trio', 'coordinator'],
  ] as const)('%s %s delegation asks for a specification only', (teamId, entryPoint) => {
    const template = renderPair({ teamId, fromRole: entryPoint, toRole: 'product-manager' });

    expect(template).toContain('next-role="product-manager"');
    expect(template).toContain('Skip it for small bug fixes');
    expect(template).toContain('specification only');
  });
});
