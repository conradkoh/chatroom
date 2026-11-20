import { describe, expect, test } from 'vitest';

import { getReviewGuidelines } from './review';

describe('getReviewGuidelines readability and comments', () => {
  test('directs the reviewer to assess readability and comment quality', () => {
    const guidelines = getReviewGuidelines();

    expect(guidelines).toContain('**Readability & Comments:**');
    expect(guidelines).toContain('Comments explain intent or the reason for a choice');
    expect(guidelines).toContain('the exact rename, restructure, or rewritten comment');
  });
});
