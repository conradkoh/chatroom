import { describe, expect, test } from 'vitest';

import { getRoleTemplate, ROLE_TEMPLATES } from './templates';

describe('role templates', () => {
  test('architect metadata identifies the architect as a non-implementer', () => {
    const template = ROLE_TEMPLATES.architect;

    expect(template).toBeDefined();
    expect(template.role).toBe('architect');
    expect(template.title).toBe('Architect');
    expect(template.defaultHandoffTarget).toBe('planner');
    expect(template.description).toBe(
      'You are the architect responsible for producing one complete implementation design for the request; you are not an implementer.'
    );
    expect(template.responsibilities).toHaveLength(5);
  });

  test('UI/UX engineer metadata identifies the UI/UX engineer as a non-implementer', () => {
    const template = ROLE_TEMPLATES['uiux-engineer'];

    expect(template).toBeDefined();
    expect(template.role).toBe('uiux-engineer');
    expect(template.title).toBe('UI/UX Engineer');
    expect(template.defaultHandoffTarget).toBe('planner');
    expect(template.description).toBe(
      'You are the UI/UX engineer responsible for producing one complete interface and experience design for the request; you are not an implementer.'
    );
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

  test('uses a lifecycle-neutral template for the legacy ephemeral role', () => {
    const template = getRoleTemplate('enhancer');
    const text = [template.description, ...template.responsibilities].join(' ');

    expect(template.role).toBe('enhancer');
    expect(template.title).toBe('Ephemeral Agent');
    expect(text).not.toMatch(/enhancer/i);
    expect(text).not.toMatch(/single-turn|memoryless/i);
    expect(template.defaultHandoffTarget).toBe('user');
  });
});
