/**
 * parsePlan — Unit Tests
 *
 * Covers the golden backward-compatibility fixture, the happy path, every one
 * of the 15 error codes and the two limit rules. Tests are written against the
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

  describe('unclosed code fences', () => {
    it('PLAN_FENCE_UNCLOSED: an open fence in the last bullet is rejected at its opening line', () => {
      const markdown = makePlan({
        phases: [
          { id: 'P1', title: 'Phase 1', acceptance: ['Phase acceptance.', 'Example:\n  ```'] },
        ],
        remarks: 'Remarks text.',
      });
      const errors = fail(markdown);
      const fenceLine = markdown.split('\n').indexOf('  ```') + 1;
      expect(errorLine(errors, 'PLAN_FENCE_UNCLOSED')).toBe(fenceLine);
    });

    it('PLAN_FENCE_UNCLOSED: a closed fence is not an error', () => {
      const markdown = makePlan({ requirements: ['Example:\n  ```\n  code\n  ```'] });
      expect(parsePlan(markdown).ok).toBe(true);
    });

    it('keeps a plain ``` line and a heading inside a 4-backtick fence', () => {
      const result = parsePlan(
        makePlan({ requirements: ['Example:\n  ````\n  ```\n  # Not a section\n  ````'] })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual([
        'Example:\n  ````\n  ```\n  # Not a section\n  ````',
      ]);
    });

    it('treats ```python inside a ``` fence as content', () => {
      const result = parsePlan(
        makePlan({ requirements: ['Example:\n  ```\n  ```python\n  ## Not a section\n  ```'] })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual([
        'Example:\n  ```\n  ```python\n  ## Not a section\n  ```',
      ]);
    });

    it('PLAN_FENCE_UNCLOSED: a 4-backtick opener needs a 4-backtick closer', () => {
      const markdown = makePlan({ requirements: ['Example:\n  ````\n  ```'] });
      const errors = fail(markdown);
      const fenceLine = markdown.split('\n').indexOf('  ````') + 1;
      expect(errorLine(errors, 'PLAN_FENCE_UNCLOSED')).toBe(fenceLine);
    });
  });

  describe('stray paragraphs', () => {
    it('PLAN_STRAY_CONTENT: unindented text after a blank line is rejected at its own line', () => {
      const markdown = makePlan().replace(
        '- Requirement one.',
        '- Requirement one.\n\nStray paragraph.'
      );
      const errors = fail(markdown);
      const strayLine = markdown.split('\n').indexOf('Stray paragraph.') + 1;
      expect(errorLine(errors, 'PLAN_STRAY_CONTENT')).toBe(strayLine);
    });

    it('PLAN_STRAY_CONTENT: an in-section paragraph with no open bullet is a stray, not a section-order error', () => {
      const markdown = makePlan().replace(
        '## Requirements\n- Requirement one.',
        '## Requirements\n\nStray paragraph.\n- Requirement one.'
      );
      const errors = fail(markdown);
      const strayLine = markdown.split('\n').indexOf('Stray paragraph.') + 1;
      expect(errorLine(errors, 'PLAN_STRAY_CONTENT')).toBe(strayLine);
      expect(errors.some((error) => error.code === 'PLAN_SECTION_ORDER')).toBe(false);
    });

    it('PLAN_STRAY_CONTENT: the rest of a stray paragraph is not reported again', () => {
      const markdown = makePlan().replace(
        '- Requirement one.',
        '- Requirement one.\n\nStray one.\nStray two.'
      );
      const errors = fail(markdown);
      const strayLine = markdown.split('\n').indexOf('Stray one.') + 1;
      const strays = errors.filter((error) => error.code === 'PLAN_STRAY_CONTENT');
      expect(strays).toHaveLength(1);
      expect(strays[0].line).toBe(strayLine);
      expect(errors.some((error) => error.code === 'PLAN_SECTION_ORDER')).toBe(false);
    });

    it('PLAN_STRAY_CONTENT: a blank-separated second stray paragraph is reported at its own line', () => {
      const markdown = makePlan().replace(
        '- Requirement one.',
        '- Requirement one.\n\nStray one.\n\nStray two.'
      );
      const errors = fail(markdown);
      const strays = errors.filter((error) => error.code === 'PLAN_STRAY_CONTENT');
      expect(strays.map((error) => error.line)).toEqual([
        markdown.split('\n').indexOf('Stray one.') + 1,
        markdown.split('\n').indexOf('Stray two.') + 1,
      ]);
    });

    it('PLAN_SECTION_ORDER: unindented text outside every section is an orphan', () => {
      const markdown = makePlan().replace('# Test plan', '# Test plan\n\nOrphan text.');
      const errors = fail(markdown);
      const orphanLine = markdown.split('\n').indexOf('Orphan text.') + 1;
      expect(errorLine(errors, 'PLAN_SECTION_ORDER')).toBe(orphanLine);
    });

    it('keeps indented text after a blank line as part of the bullet', () => {
      const result = parsePlan(
        makePlan().replace('- Requirement one.', '- Requirement one.\n\n  Indented continuation.')
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual(['Requirement one.\n  Indented continuation.']);
    });

    it('keeps unindented text directly under a bullet (no blank line) as lazy continuation', () => {
      const result = parsePlan(
        makePlan().replace('- Requirement one.', '- Requirement one.\nLazy continuation.')
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual(['Requirement one.\nLazy continuation.']);
    });

    it('keeps an unindented blank-separated line inside an open fence as fence content', () => {
      const result = parsePlan(
        makePlan({ requirements: ['Example:\n  ```\n\nunindented inside fence\n  ```'] })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual([
        'Example:\n  ```\n\nunindented inside fence\n  ```',
      ]);
    });
  });

  describe('indented headings', () => {
    it('treats an indented # line as bullet continuation', () => {
      const result = parsePlan(makePlan({ requirements: ['Requirement one.\n  # run this'] }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual(['Requirement one.\n  # run this']);
    });

    it('treats an indented ## line as bullet continuation', () => {
      const result = parsePlan(makePlan({ requirements: ['Requirement one.\n  ## run this'] }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.requirements).toEqual(['Requirement one.\n  ## run this']);
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

  describe('over-long input', () => {
    it('returns exactly one PLAN_TOO_LONG error for a 1 MB body and does not scan it', () => {
      const errors = fail('## x\n'.repeat(200_000));
      expect(errors.map(({ code, line, message }) => [code, line, message])).toEqual([
        ['PLAN_TOO_LONG', 1, 'Plan must be 40000 characters or less (got 1000000)'],
      ]);
    });
  });

  it('never throws on blank, garbage, or over-long input', () => {
    expect(() => parsePlan('')).not.toThrow();
    expect(() => parsePlan('garbage')).not.toThrow();
    expect(() => parsePlan('x'.repeat(40_001))).not.toThrow();
  });
});
