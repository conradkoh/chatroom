import { describe, expect, test } from 'vitest';

import {
  getFrontendDesignUxFlowChecklistBlock,
  getFrontendDesignUxPlanningPrinciplesBlock,
  getFrontendDesignUxTriggerDescription,
} from './frontend-design-ux-checklist';

describe('frontend-design-ux-checklist', () => {
  test('planning principles discourage inventing unadopted style choices', () => {
    const block = getFrontendDesignUxPlanningPrinciplesBlock();
    expect(block).toContain('repository patterns');
    expect(block).toContain('project has not adopted');
  });

  test('flow checklist covers essential UX dimensions from the former reference', () => {
    const block = getFrontendDesignUxFlowChecklistBlock();
    expect(block).toContain('**States:**');
    expect(block).toContain('no layout shift');
    expect(block).toContain('**Patterns:**');
    expect(block).toContain('**Shortcuts:**');
    expect(block).toContain('**Feedback:**');
    expect(block).toContain('**Interaction affordance:**');
    expect(block).toContain('pointer cursor');
    expect(block).toContain('**Safeguards:**');
    expect(block).toContain('bulk operations');
  });

  test('trigger description matches UI-change scope', () => {
    expect(getFrontendDesignUxTriggerDescription()).toBe(
      'when the user request involves user interface changes'
    );
  });
});
