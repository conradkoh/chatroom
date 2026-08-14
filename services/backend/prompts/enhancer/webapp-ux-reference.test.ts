import { describe, expect, it } from 'vitest';

import {
  getUxReviewTriggerDescription,
  renderWebappUxHandoffReference,
  renderWebappUxReference,
} from './webapp-ux-reference';

describe('webapp UX reference', () => {
  it('contains ten project-agnostic checklist items with frontend-design dimensions', () => {
    const ref = renderWebappUxReference();
    expect(ref.match(/^\d+\. /gm) ?? []).toHaveLength(10);
    expect(ref).toContain('### Review principles');
    expect(ref).toContain('no layout shift');
    expect(ref).toContain('explicitly handled');
    expect(ref).toContain('**Interaction affordance**');
    expect(ref).toContain('pointer cursor');
    expect(ref).not.toContain('`cursor: pointer`');
    expect(ref).not.toContain('### Layout simplification');
    expect(ref).not.toContain('### Fast user feedback');
    expect(ref).not.toContain('### Keyboard shortcuts');
    expect(ref).not.toContain('justify-between');
    expect(ref).not.toContain('Saving...');
    expect(ref).not.toContain('responsive utility classes');
  });

  it('keeps the handoff trigger', () => {
    expect(getUxReviewTriggerDescription()).toBe(
      'when the planner check-in proposes user interface changes'
    );
    expect(renderWebappUxHandoffReference()).toContain('**UX** section');
  });
});
