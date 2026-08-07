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

  it('lists all 10 UX review checklist items', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('5. **States**');
    expect(ref).toContain('6. **Error boundaries**');
    expect(ref).toContain('7. **Alignment**');
    expect(ref).toContain('8. **Feedback**');
    expect(ref).toContain('9. **Destructive actions**');
    expect(ref).toContain('10. **Bulk actions**');
  });

  it('documents destructive and bulk action safeguard patterns', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('### Destructive & bulk action safeguards');
    expect(ref).toContain('LifecycleConfirmDialog');
    expect(ref).toContain('Clear stuck commands?');
  });

  it('documents error/loading, error boundary, alignment, and feedback sections', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('### Error & loading states');
    expect(ref).toContain('### Error boundaries');
    expect(ref).toContain('### Alignment & component hierarchy');
    expect(ref).toContain('### Fast user feedback');
    expect(ref).toContain('ChatroomLoader');
    expect(ref).toContain('ErrorBoundary');
    expect(ref).toContain('isModEnterKey');
    expect(ref).toContain('toMatchInlineSnapshot');
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
