import { describe, expect, it } from 'vitest';

import {
  getDefragmentationReviewTriggerDescription,
  renderDefragmentationHandoffReference,
} from './defragmentation-reference';

describe('renderDefragmentationHandoffReference', () => {
  it('documents the four-step workflow and optional domain model', () => {
    const ref = renderDefragmentationHandoffReference();
    expect(ref).toContain('1. **Study surfaces**');
    expect(ref).toContain('2. **Golden implementation**');
    expect(ref).toContain('3. **Migrate callers**');
    expect(ref).toContain('4. **Delete legacy**');
    expect(ref).toContain('only when the studied variants require them');
  });

  it('documents broad triggers and anti-patterns without project references', () => {
    const ref = renderDefragmentationHandoffReference();
    expect(ref).toContain('### Anti-patterns to flag');
    expect(ref).toContain('**Defragmentation** section');
    expect(ref).toContain('"Not Applicable."');
    expect(ref).toContain('large or multi-surface system revision');
    expect(ref).not.toContain('apps/webapp');
  });
});

describe('getDefragmentationReviewTriggerDescription', () => {
  it('mentions large revisions and consistency', () => {
    expect(getDefragmentationReviewTriggerDescription()).toContain('large or multi-surface');
    expect(getDefragmentationReviewTriggerDescription()).toContain('consistency');
  });
});
