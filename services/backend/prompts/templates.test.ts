import { describe, expect, test } from 'vitest';

import { ROLE_TEMPLATES } from './templates';

describe('role templates', () => {
  test.each([
    ['architect', 'Architect'],
    ['uiux-engineer', 'UI/UX Engineer'],
  ])('%s has specialist metadata', (role, title) => {
    const template = ROLE_TEMPLATES[role];

    expect(template).toBeDefined();
    expect(template.role).toBe(role);
    expect(template.title).toBe(title);
    expect(template.defaultHandoffTarget).toBe('planner');
    expect(template.description).toMatch(/advisor/i);
    expect(template.description).toMatch(/not an implementer/i);
    expect(template.responsibilities).toHaveLength(5);
  });

  test('architect metadata is coding-focused', () => {
    expect(ROLE_TEMPLATES.architect.responsibilities).toEqual([
      'Recover the authoritative user request and relevant history',
      'Inspect repository patterns and identify the coding change surface',
      'Design module boundaries, APIs, schemas, queries, invariants, and failure handling',
      'Specify the implementation and verification sequence at code granularity',
      'Hand one evidence-backed design to the planner for implementation',
    ]);
  });

  test('uiux-engineer metadata is interface-focused', () => {
    expect(ROLE_TEMPLATES['uiux-engineer'].responsibilities).toEqual([
      'Recover the authoritative user request and relevant history',
      'Inspect existing UI patterns, components, tokens, and interaction conventions',
      'Design complete user flows including loading, empty, error, and success states',
      'Specify accessibility, keyboard behavior, responsive layout, state ownership, and UI tests',
      'Hand one evidence-backed design to the planner for implementation',
    ]);
  });

  test('preserves the enhancer template contract', () => {
    expect(ROLE_TEMPLATES.enhancer.role).toBe('enhancer');
    expect(ROLE_TEMPLATES.enhancer.defaultHandoffTarget).toBe('planner');
  });
});
