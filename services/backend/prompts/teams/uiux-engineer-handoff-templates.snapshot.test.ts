import { describe, expect, test } from 'vitest';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';

/** Every pair in either team shape whose sender or recipient is the UI/UX engineer. */
const uiuxEngineerPairs = [
  ...listHandoffTemplatePairs('duo'),
  ...listHandoffTemplatePairs('solo'),
].filter((pair) => pair.fromRole === 'uiux-engineer' || pair.toRole === 'uiux-engineer');

function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

describe('UI/UX engineer handoff template snapshots', () => {
  const returnTemplates = [
    renderPair({ teamId: 'duo', fromRole: 'uiux-engineer', toRole: 'planner' }),
    renderPair({ teamId: 'solo', fromRole: 'uiux-engineer', toRole: 'solo' }),
  ];

  test.each(uiuxEngineerPairs)(
    '$teamId $fromRole → $toRole renders the complete contract',
    (pair) => {
      expect(renderPair(pair)).toMatchSnapshot();
    }
  );

  test.each(returnTemplates)('makes accessibility implementation opt-in', (template) => {
    expect(template).toContain(
      'Do not propose or require web accessibility implementation work unless the user explicitly requests it.'
    );
    expect(template).not.toMatch(
      /accessibility test|accessible semantics|keyboard shortcuts|focus order/i
    );
  });
});
