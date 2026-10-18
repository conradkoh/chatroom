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
