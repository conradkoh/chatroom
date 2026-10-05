import { AGENT_ROLE_DEFINITIONS } from '@workspace/shared/domain/agent-role';
import { describe, expect, test } from 'vitest';

import { BUILTIN_ROLE_TEMPLATES, getRoleTemplate, ROLE_TEMPLATES } from './templates';

describe('role templates', () => {
  test('every builtin role has a dedicated nonempty prompt object', () => {
    for (const [role, definition] of Object.entries(AGENT_ROLE_DEFINITIONS)) {
      const template = BUILTIN_ROLE_TEMPLATES[role as keyof typeof BUILTIN_ROLE_TEMPLATES];
      expect(template).toBeDefined();
      expect(template.role).toBe(role);
      expect(template.description.trim()).not.toBe('');
      expect(template.responsibilities.length).toBeGreaterThan(0);
      expect(ROLE_TEMPLATES[role]).toBe(template);
      expect(definition.role).toBe(role);
    }
  });

  test('retains tester as a custom prompt and unknown roles use the generic fallback', () => {
    expect(ROLE_TEMPLATES.tester).toMatchObject({
      role: 'tester',
      title: 'Tester',
      description: 'You are the QA role responsible for testing and validation.',
      responsibilities: [
        'Write and execute test cases',
        'Verify functionality works as expected',
        'Test edge cases and error handling',
        'Report bugs and issues clearly',
        'Confirm quality standards are met',
      ],
      defaultHandoffTarget: 'user',
    });
    expect(getRoleTemplate('reviewer').description).toContain('participating as the reviewer');
    expect(BUILTIN_ROLE_TEMPLATES).not.toHaveProperty('tester');
  });

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

  test('triage metadata identifies an evidence-driven non-implementer', () => {
    const template = ROLE_TEMPLATES.triage;

    expect(template.role).toBe('triage');
    expect(template.title).toBe('Triage Agent');
    expect(template.description).toContain('you do not implement fixes');
    expect(template.defaultHandoffTarget).toBe('planner');
    expect(template.responsibilities).toEqual([
      'Recover the reported symptoms and expected behavior from the authoritative request and relevant history',
      'Trace the relevant code and state flow to identify a root cause, citing concrete repository evidence',
      'Attempt to reproduce the issue with the smallest focused automated test and report the result honestly',
      'Recommend the smallest immediate fix without implementing it',
      'Report systemic design risks separately from the immediate fix',
      'Hand the complete investigation report to the configured entry point',
    ]);
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
      'Specify responsive layout, state ownership, and UI tests; include web accessibility implementation only when explicitly requested by the user',
      'Hand one evidence-backed design to the planner for implementation',
    ]);
    expect(ROLE_TEMPLATES['uiux-engineer'].responsibilities[3]).toContain(
      'web accessibility implementation only when explicitly requested by the user'
    );
  });

  test('uses a lifecycle-neutral template for the legacy ephemeral role', () => {
    const template = getRoleTemplate('enhancer');
    const text = [template.description, ...template.responsibilities].join(' ');

    expect(template.role).toBe('enhancer');
    expect(template.title).toBe('Ephemeral Agent');
    expect(text).not.toMatch(/enhancer/i);
    expect(text).not.toMatch(/single-turn|memoryless/i);
    expect(template.defaultHandoffTarget).toBe('user');
    expect(BUILTIN_ROLE_TEMPLATES).not.toHaveProperty('enhancer');
  });
});
