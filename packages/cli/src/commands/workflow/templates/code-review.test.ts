/**
 * Code Review Template — Pillar Verification Tests
 *
 * Verifies that all 8 pillars are materialized in the template,
 * the sequential dependsOn chain is correct, and each pillar
 * contains the expected content.
 */

import { describe, expect, it } from 'vitest';

import { getCodeReviewTemplate, REVIEW_REQUIREMENTS } from './code-review.js';

describe('getCodeReviewTemplate', () => {
  const template = getCodeReviewTemplate('planner');

  it('has exactly 8 steps', () => {
    expect(template.steps).toHaveLength(8);
  });

  it('has key set to code-review', () => {
    expect(template.key).toBe('code-review');
  });

  it('steps form a sequential dependsOn chain', () => {
    // Step 1 has no dependencies
    expect(template.steps[0]!.dependsOn).toEqual([]);

    // Steps 2..8 each depend on the previous step's key
    for (let i = 1; i < template.steps.length; i++) {
      const prevKey = template.steps[i - 1]!.stepKey;
      expect(template.steps[i]!.dependsOn).toEqual([prevKey]);
    }
  });

  it('steps have sequential order numbers', () => {
    for (let i = 0; i < template.steps.length; i++) {
      expect(template.steps[i]!.order).toBe(i + 1);
    }
  });

  it('all steps have non-empty specification.goal (length > 50)', () => {
    for (const step of template.steps) {
      expect(step.specification).toBeDefined();
      expect(step.specification!.goal.length).toBeGreaterThan(50);
    }
  });

  it('all steps have the same specification.requirements string', () => {
    for (const step of template.steps) {
      expect(step.specification!.requirements).toBe(REVIEW_REQUIREMENTS);
    }
  });

  it('all steps have assigneeRole set to the role parameter', () => {
    for (const step of template.steps) {
      expect(step.assigneeRole).toBe('planner');
    }
  });

  // ── Per-pillar content checks ──────────────────────────────────────────

  it('pillar-1-simplification contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-1-simplification')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Simplification');
    expect(step.specification!.goal).toContain('40 lines');
    expect(step.specification!.goal).toContain('Phantom Bugs');
  });

  it('pillar-2-type-drift contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-2-type-drift')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Type Drift');
    expect(step.specification!.goal).toContain('strictNullChecks');
    expect(step.specification!.goal).toContain('Unsafe');
  });

  it('pillar-3-duplication contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-3-duplication')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Duplication');
    expect(step.specification!.goal).toContain('copy/pasted');
    expect(step.specification!.goal).toContain('Vanilla Style');
  });

  it('pillar-4-design-patterns contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-4-design-patterns')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Design Pattern');
    expect(step.specification!.goal).toContain('SOLID');
    expect(step.specification!.goal).toContain('ADR');
  });

  it('pillar-5-security contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-5-security')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Security');
    expect(step.specification!.goal).toContain('OWASP');
    expect(step.specification!.goal).toContain('XSS');
  });

  it('pillar-6-test-quality contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-6-test-quality')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Test Quality');
    expect(step.specification!.goal).toContain('Coverage theater');
    expect(step.specification!.goal).toContain('mutation testing');
  });

  it('pillar-7-ownership contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-7-ownership')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Ownership');
    expect(step.specification!.goal).toContain('CODEOWNERS');
    expect(step.specification!.goal).toContain('shadow AI');
  });

  it('pillar-8-dead-code contains expected content', () => {
    const step = template.steps.find((s) => s.stepKey === 'pillar-8-dead-code')!;
    expect(step).toBeDefined();
    expect(step.specification!.goal).toContain('Dead Code');
    expect(step.specification!.goal).toContain('tree-shaking');
    expect(step.specification!.goal).toContain('ts-prune');
  });
});
