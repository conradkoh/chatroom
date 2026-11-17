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

      let previousIndex = -1;
      for (const heading of reportHeadings) {
        const index = template.indexOf(heading);
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
  ] as const)('%s %s delegation asks for a specification only', (teamId, entryPoint) => {
    const template = renderPair({ teamId, fromRole: entryPoint, toRole: 'product-manager' });

    expect(template).toContain('next-role="product-manager"');
    expect(template).toContain('Skip it for small bug fixes');
    expect(template).toContain('specification only');
  });
});
