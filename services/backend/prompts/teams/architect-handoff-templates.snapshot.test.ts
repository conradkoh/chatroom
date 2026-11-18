import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the architect. */
const architectPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
  ...listHandoffTemplatePairs('trio'),
].filter((pair) => pair.fromRole === 'architect' || pair.toRole === 'architect');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

describe('architect handoff template snapshots', () => {
  test.each(architectPairs)('$teamId $fromRole → $toRole renders the complete contract', (pair) => {
    expect(renderPair(pair)).toMatchSnapshot();
  });
});

describe('architect handoff template — escalation contract', () => {
  const architectToEntryPointPairs = architectPairs.filter((pair) => pair.fromRole === 'architect');

  test.each(architectToEntryPointPairs)(
    '$teamId architect → $toRole keeps the design sections in order',
    (pair) => {
      const template = renderPair(pair);
      const headings = [
        '## Summary',
        '## Goal',
        '## Key Knowledge for High Quality Bar',
        '## Force Multipliers',
        '## Files to implement (exhaustive, file-level)',
        `## Shared contracts (${pair.toRole}-owned)`,
        '## Requirements (acceptance criteria)',
        '## What to avoid',
        '## Skills to activate',
        '## Out of scope',
        '## Escalation items for the user',
      ];
      // Match section headings as whole lines: section bodies may reference another heading name inline.
      const headingLines = template.split('\n').filter((line) => line.startsWith('## '));

      let previousIndex = -1;
      for (const heading of headings) {
        const index = headingLines.indexOf(heading);
        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }
    }
  );

  test.each(architectToEntryPointPairs)(
    '$teamId architect → $toRole decides technical decisions and escalates only by criteria',
    (pair) => {
      const template = renderPair(pair);
      const escalation = template.slice(template.indexOf('## Escalation items for the user'));

      expect(template).toContain(
        'Decide every open technical decision yourself inside the one design'
      );
      expect(template).toContain('(b) the decision involves deletion, data loss');
      expect(escalation).toContain('Do not list technical choices here');
      expect(escalation).toContain('`None observed.`');
    }
  );
});
