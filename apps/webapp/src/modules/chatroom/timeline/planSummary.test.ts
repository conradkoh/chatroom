import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getPlanSummary } from './planSummary';

/** Golden fixture from the backend, read from disk so this suite cannot drift from it. From this directory it is six levels up to the repo root. */
const PLAN_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../../../services/backend/src/domain/plan/__fixtures__/plan-v1.md'),
  'utf-8'
);

/** Build a valid plan with `count` phases (1..20). */
function planWithPhases(count: number): string {
  const list = Array.from({ length: count }, (_, index) => `- P${index + 1} — Phase ${index + 1}`);
  const details = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return [
      `### P${id} — Phase ${id}`,
      '',
      '#### Requirements',
      '',
      `- Requirement ${id}.`,
      '',
      '#### Constraints',
      '',
      '- None.',
      '',
      '#### Acceptance criteria',
      '',
      `- Acceptance ${id}.`,
    ].join('\n');
  });
  return [
    '# Generated plan',
    '',
    '## Sources',
    '',
    '- src-1',
    '',
    '## Requirements',
    '',
    '- Ship it.',
    '',
    '## Constraints',
    '',
    '- None.',
    '',
    '## Phases',
    '',
    ...list,
    '',
    '## Phase details',
    '',
    details.join('\n\n'),
  ].join('\n');
}

describe('getPlanSummary', () => {
  it('summarises the golden fixture as a structured plan', () => {
    expect(getPlanSummary(PLAN_FIXTURE)).toEqual({
      kind: 'structured',
      title: 'Add plan messages to the chatroom',
      phaseCount: 3,
      phases: [
        { id: 'P1', title: 'Schema and parser' },
        { id: 'P2', title: 'Backend write and read path' },
        { id: 'P3', title: 'Timeline rendering' },
      ],
      hiddenPhaseCount: 0,
    });
  });

  it('shows the first four phases of a 20-phase plan and counts the other 16', () => {
    const summary = getPlanSummary(planWithPhases(20));
    expect(summary.kind).toBe('structured');
    if (summary.kind !== 'structured') return;
    expect(summary.phaseCount).toBe(20);
    expect(summary.phases.map((phase) => phase.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(summary.hiddenPhaseCount).toBe(16);
  });

  it('reports a single phase with no hidden phases', () => {
    const summary = getPlanSummary(planWithPhases(1));
    expect(summary).toMatchObject({ kind: 'structured', phaseCount: 1, hiddenPhaseCount: 0 });
  });

  it('falls back to the plain-text preview for content that is not a plan', () => {
    expect(getPlanSummary('Just some prose, not a plan.')).toEqual({
      kind: 'fallback',
      text: 'Just some prose, not a plan.',
    });
  });

  it('returns an empty fallback for blank content', () => {
    expect(getPlanSummary('   \n\t ')).toEqual({ kind: 'fallback', text: '' });
  });

  it('returns the code-block placeholder for fenced-only content', () => {
    expect(getPlanSummary('```ts\nconst x = 1;\n```')).toEqual({
      kind: 'fallback',
      text: '(code block)',
    });
  });

  it('falls back for content over the plan size cap', () => {
    expect(getPlanSummary('a'.repeat(40_001))).toMatchObject({ kind: 'fallback' });
  });

  it.each([
    ['empty string', ''],
    ['lone fence opener', '```'],
    ['control characters', '\u0000\u0001# \n- \u0007'],
    ['over the 40,000-character plan cap', 'a'.repeat(40_001)],
  ])('never throws for %s', (_label, content) => {
    expect(() => getPlanSummary(content)).not.toThrow();
  });
});
