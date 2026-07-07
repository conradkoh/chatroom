import { describe, expect, test } from 'vitest';

import { getDelegationBriefDisclosureBlock } from './delegation-disclosure';

describe('delegation-disclosure', () => {
  test('includes checkbox attesting delegation brief completion', () => {
    const block = getDelegationBriefDisclosureBlock();
    expect(block).toContain(
      'I confirm that the goal and acceptance criteria from the planner\u2019s delegation brief have been met'
    );
  });

  test('includes comment referencing Goal and Requirements sections', () => {
    const block = getDelegationBriefDisclosureBlock();
    expect(block).toContain('## Goal');
    expect(block).toContain('## Requirements (acceptance criteria)');
  });
});
