/**
 * parsePlan — Unit Tests
 *
 * Covers the golden backward-compatibility fixture, the happy path, every one
 * of the 13 error codes and the two limit rules. Tests are written against the
 * pure exported seam `parsePlan`; they never reach into parser internals.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parsePlan, type PlanParseError, type ParsedPlan } from './parse-plan';
import { PLAN_MAX_PHASES, type PlanParseErrorCode } from './plan-template-spec';

interface PhaseSpec {
  id: string;
  title: string;
  dependsOn?: string[] | null;
  requirements?: string[];
  constraints?: string[] | null;
  acceptance?: string[];
  detailTitle?: string;
}

interface PlanSpec {
  title?: string;
  sources?: string[] | null;
  requirements?: string[];
  constraints?: string[] | null;
  phases?: PhaseSpec[];
  remarks?: string | null;
  detailIds?: string[];
}

/** Push `- item` bullets, or `- None.` when the list is `null`. */
function pushList(lines: string[], items: string[] | null | undefined): void {
  if (items === null) {
    lines.push('- None.');
    return;
  }
  for (const item of items ?? []) lines.push(`- ${item}`);
}

/** Build a canonical plan document for the case under test. */
function makePlan(spec: PlanSpec = {}): string {
  const phases = spec.phases ?? [{ id: 'P1', title: 'Phase 1' }];
  const detailIds = spec.detailIds ?? phases.map((phase) => phase.id);
  const remarks = spec.remarks === undefined ? null : spec.remarks;

  const lines: string[] = [`# ${spec.title ?? 'Test plan'}`, ''];
  lines.push('## Sources');
  pushList(lines, spec.sources === undefined ? ['src-1'] : spec.sources);
  lines.push('', '## Requirements');
  pushList(lines, spec.requirements ?? ['Requirement one.']);
  lines.push('', '## Constraints');
  pushList(lines, spec.constraints === undefined ? null : spec.constraints);
  lines.push('', '## Phases');
  for (const phase of phases) lines.push(`- ${phase.id} — ${phase.title}`);
  lines.push('', '## Phase details');
  for (const phase of phases) {
    if (!detailIds.includes(phase.id)) continue;
    lines.push('', `### ${phase.id} — ${phase.detailTitle ?? phase.title}`, '');
    if (phase.dependsOn !== undefined && phase.dependsOn !== null && phase.dependsOn.length > 0) {
      lines.push('#### Depends on');
      pushList(lines, phase.dependsOn);
      lines.push('');
    }
    lines.push('#### Requirements');
    pushList(lines, phase.requirements ?? ['Phase requirement.']);
    lines.push('', '#### Constraints');
    pushList(lines, phase.constraints === undefined ? null : phase.constraints);
    lines.push('', '#### Acceptance criteria');
    pushList(lines, phase.acceptance ?? ['Phase acceptance.']);
  }
  if (remarks !== null) lines.push('', '## Remarks', remarks);
  return lines.join('\n');
}

function fail(markdown: string): PlanParseError[] {
  const result = parsePlan(markdown);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected parsePlan to fail');
  return result.errors;
}

function errorLine(errors: PlanParseError[], code: PlanParseErrorCode): number | undefined {
  return errors.find((error) => error.code === code)?.line;
}

describe('parsePlan', () => {
  it('parses the golden v1 fixture exactly', () => {
    const markdown = readFileSync(new URL('./__fixtures__/plan-v1.md', import.meta.url), 'utf8');
    const expected: ParsedPlan = {
      title: 'Add plan messages to the chatroom',
      sources: ['jd7273e5rtyssejd198vkssnhx8jse03'],
      requirements: [
        'Publish a validated plan message that renders without collapsing.',
        'Keep existing message types unchanged.',
      ],
      constraints: [],
      phases: [
        {
          id: 'P1',
          title: 'Schema and parser',
          dependsOn: [],
          requirements: [
            'Add the plan literal to both message type unions.',
            'Headings inside fenced blocks are ignored:\n  ```markdown\n  ## Not a section\n  ```',
          ],
          constraints: [],
          acceptance: [
            'A valid plan parses without errors.',
            'Every error code has a failing fixture.',
          ],
        },
        {
          id: 'P2',
          title: 'Backend write and read path',
          dependsOn: ['P1'],
          requirements: [
            'Publish stores a validated plan message.',
            'Read returns the stored content.',
          ],
          constraints: ['No chatroom lastActivityAt patch.'],
          acceptance: ['Publishing an invalid plan stores nothing.'],
        },
        {
          id: 'P3',
          title: 'Timeline rendering',
          dependsOn: ['P1'],
          requirements: ['The plan row never collapses.'],
          constraints: [],
          acceptance: ['A plan between two handoffs renders expanded.'],
        },
      ],
      remarks: 'The plan row renders title, phases, and per-phase details.',
    };

    expect(parsePlan(markdown)).toEqual({ ok: true, plan: expected });
  });

  it('parses a minimal valid plan with None. sources and constraints', () => {
    const result = parsePlan(
      makePlan({
        sources: null,
        constraints: null,
        phases: [{ id: 'P1', title: 'Only phase' }],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sources).toEqual([]);
    expect(result.plan.constraints).toEqual([]);
    expect(result.plan.remarks).toBeNull();
    expect(result.plan.phases).toHaveLength(1);
  });

  it('parses a 20-phase plan', () => {
    const phases: PhaseSpec[] = Array.from({ length: PLAN_MAX_PHASES }, (_, index) => ({
      id: `P${index + 1}`,
      title: `Phase ${index + 1}`,
    }));
    const result = parsePlan(makePlan({ phases }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.phases).toHaveLength(PLAN_MAX_PHASES);
  });

  it('treats headings inside fenced blocks as content', () => {
    const markdown = [
      '# Test plan',
      '',
      '## Sources',
      '- None.',
      '',
      '## Requirements',
      '- Real requirement.',
      '- Fenced:',
      '  ```',
      '  ## Not a section',
      '  ```',
      '',
      '## Constraints',
      '- None.',
      '',
      '## Phases',
      '- P1 — Phase 1',
      '',
      '## Phase details',
      '',
      '### P1 — Phase 1',
      '',
      '#### Requirements',
      '- Phase requirement.',
      '',
      '#### Constraints',
      '- None.',
      '',
      '#### Acceptance criteria',
      '- Phase acceptance.',
    ].join('\n');

    const result = parsePlan(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.requirements).toEqual([
      'Real requirement.',
      'Fenced:\n  ```\n  ## Not a section\n  ```',
    ]);
  });

  describe('None. rules', () => {
    it('allows None. for plan constraints, plan sources and per-phase Depends on', () => {
      const result = parsePlan(
        makePlan({
          sources: null,
          constraints: null,
          phases: [
            { id: 'P1', title: 'Phase 1' },
            { id: 'P2', title: 'Phase 2', dependsOn: ['None.'] },
          ],
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.phases[1].dependsOn).toEqual([]);
    });

    it('rejects None. in Requirements', () => {
      const errors = fail(makePlan({ requirements: ['None.'] }));
      expect(errors.some((error) => error.code === 'PLAN_SECTION_EMPTY')).toBe(true);
    });

    it('rejects None. in Acceptance criteria', () => {
      const errors = fail(
        makePlan({ phases: [{ id: 'P1', title: 'Phase 1', acceptance: ['None.'] }] })
      );
      expect(errors.some((error) => error.code === 'PLAN_PHASE_SECTION_MISSING')).toBe(true);
    });

    it('rejects None. mixed with real items in an allowed section', () => {
      const errors = fail(makePlan({ constraints: ['None.', 'Real constraint.'] }));
      expect(errors.some((error) => error.code === 'PLAN_SECTION_ORDER')).toBe(true);
    });
  });

  describe('sequential phase ids', () => {
    it('rejects duplicate ids', () => {
      const errors = fail(
        makePlan({
          phases: [
            { id: 'P1', title: 'Phase 1' },
            { id: 'P1', title: 'Phase 2' },
          ],
        })
      );
      expect(errors.some((error) => error.code === 'PLAN_PHASE_ID_INVALID')).toBe(true);
    });

    it('rejects a gap', () => {
      const errors = fail(
        makePlan({
          phases: [
            { id: 'P1', title: 'Phase 1' },
            { id: 'P3', title: 'Phase 3' },
          ],
        })
      );
      expect(errors.some((error) => error.code === 'PLAN_PHASE_ID_INVALID')).toBe(true);
    });

    it('rejects P0', () => {
      const errors = fail(makePlan({ phases: [{ id: 'P0', title: 'Phase 0' }] }));
      expect(errors.some((error) => error.code === 'PLAN_PHASE_ID_INVALID')).toBe(true);
    });
  });

  describe('error codes', () => {
    it('PLAN_TITLE_MISSING', () => {
      const markdown = makePlan().split('\n').slice(2).join('\n');
      const errors = fail(markdown);
      expect(errorLine(errors, 'PLAN_TITLE_MISSING')).toBe(1);
    });

    it('PLAN_SECTION_MISSING', () => {
      const errors = fail(makePlan().replace('## Constraints\n- None.\n\n', ''));
      expect(errors.some((error) => error.code === 'PLAN_SECTION_MISSING')).toBe(true);
    });

    it('PLAN_SECTION_ORDER', () => {
      const errors = fail(`${makePlan()}\n\n## Sources\n- again`);
      expect(errors.some((error) => error.code === 'PLAN_SECTION_ORDER')).toBe(true);
    });

    it('PLAN_SECTION_EMPTY', () => {
      const errors = fail(makePlan({ requirements: [] }));
      const headingLine = makePlan({ requirements: [] }).split('\n').indexOf('## Requirements');
      expect(errorLine(errors, 'PLAN_SECTION_EMPTY')).toBe(headingLine + 1);
    });

    it('PLAN_PHASE_LIST_EMPTY', () => {
      const errors = fail(makePlan({ phases: [] }));
      expect(errors.some((error) => error.code === 'PLAN_PHASE_LIST_EMPTY')).toBe(true);
    });

    it('PLAN_PHASE_ID_INVALID at the bad second entry', () => {
      const markdown = makePlan({
        phases: [
          { id: 'P1', title: 'Phase 1' },
          { id: 'P3', title: 'Phase 3' },
        ],
      });
      const errors = fail(markdown);
      const badLine = markdown.split('\n').indexOf('- P3 — Phase 3') + 1;
      expect(errorLine(errors, 'PLAN_PHASE_ID_INVALID')).toBe(badLine);
    });

    it('PLAN_PHASE_DETAIL_MISSING', () => {
      const errors = fail(
        makePlan({
          phases: [
            { id: 'P1', title: 'Phase 1' },
            { id: 'P2', title: 'Phase 2' },
          ],
          detailIds: ['P1'],
        })
      );
      expect(errors.some((error) => error.code === 'PLAN_PHASE_DETAIL_MISSING')).toBe(true);
    });

    it('PLAN_PHASE_DETAIL_UNLISTED', () => {
      const errors = fail(
        `${makePlan()}\n\n### P9 — Ghost\n\n#### Requirements\n- x\n\n#### Constraints\n- None.\n\n#### Acceptance criteria\n- y`
      );
      expect(errors.some((error) => error.code === 'PLAN_PHASE_DETAIL_UNLISTED')).toBe(true);
    });

    it('PLAN_PHASE_TITLE_MISMATCH at the detail heading', () => {
      const markdown = makePlan({
        phases: [{ id: 'P1', title: 'Phase 1', detailTitle: 'Different title' }],
      });
      const errors = fail(markdown);
      const detailLine = markdown.split('\n').indexOf('### P1 — Different title') + 1;
      expect(errorLine(errors, 'PLAN_PHASE_TITLE_MISMATCH')).toBe(detailLine);
    });

    it('PLAN_PHASE_SECTION_MISSING at the phase heading', () => {
      const markdown = makePlan({
        phases: [{ id: 'P1', title: 'Phase 1', acceptance: [] }],
      });
      const errors = fail(markdown);
      const blockLine = markdown.split('\n').indexOf('### P1 — Phase 1') + 1;
      expect(errorLine(errors, 'PLAN_PHASE_SECTION_MISSING')).toBe(blockLine);
    });

    it('PLAN_DEPENDS_ON_INVALID', () => {
      const errors = fail(
        makePlan({
          phases: [
            { id: 'P1', title: 'Phase 1' },
            { id: 'P2', title: 'Phase 2', dependsOn: ['P2'] },
          ],
        })
      );
      expect(errors.some((error) => error.code === 'PLAN_DEPENDS_ON_INVALID')).toBe(true);
    });

    it('PLAN_TOO_LONG', () => {
      const errors = fail('x'.repeat(40_001));
      expect(errors.some((error) => error.code === 'PLAN_TOO_LONG')).toBe(true);
    });

    it('PLAN_TOO_MANY_PHASES', () => {
      const phases: PhaseSpec[] = Array.from({ length: PLAN_MAX_PHASES + 1 }, (_, index) => ({
        id: `P${index + 1}`,
        title: `Phase ${index + 1}`,
      }));
      const errors = fail(makePlan({ phases }));
      expect(errors.filter((error) => error.code === 'PLAN_TOO_MANY_PHASES')).toHaveLength(1);
    });
  });

  it('never throws on blank, garbage, or over-long input', () => {
    expect(() => parsePlan('')).not.toThrow();
    expect(() => parsePlan('garbage')).not.toThrow();
    expect(() => parsePlan('x'.repeat(40_001))).not.toThrow();
  });
});
