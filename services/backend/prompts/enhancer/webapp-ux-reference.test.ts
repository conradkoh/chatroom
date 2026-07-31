import { describe, expect, it } from 'vitest';

import {
  getUxReviewTriggerDescription,
  renderWebappUxHandoffReference,
  renderWebappUxReference,
} from './webapp-ux-reference';

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

  it('includes UX review checklist at top', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('### UX review checklist');
    expect(ref).toContain('1. **Flows**');
    expect(ref.indexOf('### UX review checklist') < ref.indexOf('### Keyboard shortcuts'));
  });
});

describe('renderWebappUxHandoffReference', () => {
  it('contains checklist and keyboard table', () => {
    const ref = renderWebappUxHandoffReference();
    expect(ref).toContain('### UX review checklist');
    expect(ref).toContain('1. **Flows**');
    expect(ref).toContain('⌘K');
    expect(ref.indexOf('### UX review checklist') < ref.indexOf('### Keyboard shortcuts'));
  });

  it('points UX findings to the optional UX output section', () => {
    const ref = renderWebappUxHandoffReference();
    expect(ref).toContain('**UX** section');
    expect(ref).toContain('"Not Applicable."');
  });
});

describe('getUxReviewTriggerDescription', () => {
  it('mentions user interface changes', () => {
    expect(getUxReviewTriggerDescription()).toBe(
      'when the planner check-in proposes user interface changes'
    );
  });
});
