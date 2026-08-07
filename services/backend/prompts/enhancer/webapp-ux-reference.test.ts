import { describe, expect, it } from 'vitest';

import {
  getUxReviewTriggerDescription,
  renderWebappUxHandoffReference,
  renderWebappUxReference,
} from './webapp-ux-reference';

describe('renderWebappUxReference', () => {
  it('documents responsive patterns without project-specific component names', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('responsive utility classes');
    expect(ref).not.toContain('CommandPalette');
    expect(ref).not.toContain('ChatroomLoader');
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

  it('documents destructive and bulk action safeguards without project-specific references', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('### Destructive & bulk action safeguards');
    expect(ref).toContain('confirmation dialog/modal pattern');
    expect(ref).toContain('Delete 12 items?');
    expect(ref).not.toContain('LifecycleConfirmDialog');
    expect(ref).not.toContain('apps/webapp');
    expect(ref).not.toContain('AlertDialog');
  });

  it('documents error/loading, error boundary, alignment, and feedback sections generically', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('### Error & loading states');
    expect(ref).toContain('### Error boundaries');
    expect(ref).toContain('### Alignment & component hierarchy');
    expect(ref).toContain('### Fast user feedback');
    expect(ref).toContain('centered loader or skeleton');
    expect(ref).toContain('error boundaries');
    expect(ref).not.toContain('AgentSettingsModal');
    expect(ref).not.toContain('isModEnterKey');
  });

  it('documents keyboard shortcut guidance without a project-specific catalog', () => {
    const ref = renderWebappUxReference();
    expect(ref).toContain('### Keyboard shortcuts');
    expect(ref).toContain('existing shortcut catalog');
    expect(ref).not.toContain('Chatroom switcher');
    expect(ref).not.toContain('| ⌘K');
  });
});

describe('renderWebappUxHandoffReference', () => {
  it('contains checklist and keyboard guidance', () => {
    const ref = renderWebappUxHandoffReference();
    expect(ref).toContain('### UX review checklist');
    expect(ref).toContain('1. **Flows**');
    expect(ref).toContain('### Keyboard shortcuts');
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
