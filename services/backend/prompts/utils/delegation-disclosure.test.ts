import { describe, expect, test } from 'vitest';

import { getDelegationBriefDisclosureBlock } from './delegation-disclosure';

describe('delegation-disclosure', () => {
  test('includes checkbox attesting delegation brief completion', () => {
    const block = getDelegationBriefDisclosureBlock();
    expect(block).toContain('verified end-to-end');
    expect(block).toContain('(Required) files done');
  });

  test('includes comment referencing Goal and Requirements sections', () => {
    const block = getDelegationBriefDisclosureBlock();
    expect(block).toContain('## Goal');
    expect(block).toContain('## Requirements (acceptance criteria)');
  });
});
