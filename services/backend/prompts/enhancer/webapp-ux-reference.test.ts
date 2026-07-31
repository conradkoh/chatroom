import { describe, expect, it } from 'vitest';

import { getUxReviewTriggerDescription, renderWebappUxReference } from './webapp-ux-reference';

describe('renderWebappUxReference', () => {
  it('lists canonical keyboard shortcuts', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('⌘K');
    expect(ref).toContain('⌘⇧P');
    expect(ref).toContain('Shift+Enter');
    expect(ref).toContain('⌘Enter');
  });

  it('documents responsive patterns', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('md:');
    expect(ref).toContain('hidden md:flex');
  });
});

describe('getUxReviewTriggerDescription', () => {
  it('mentions user interface changes', () => {
    expect(getUxReviewTriggerDescription()).toContain('user interface');
  });
});
