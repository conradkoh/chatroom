/**
 * renderPlanPhase — Unit Tests
 *
 * Covers the exact markdown shape used by `plan read --phase`: target marking,
 * `None.` rendering, the omitted `Depends on` block and the absent-phase null.
 */

import { describe, expect, it } from 'vitest';

import type { ParsedPlan } from './parse-plan';
import { renderPlanPhase } from './render-plan-phase';

const plan: ParsedPlan = {
  title: 'Test plan',
  sources: ['src'],
  requirements: ['R1', 'R2'],
  constraints: [],
  phases: [
    {
      id: 'P1',
      title: 'First',
      dependsOn: [],
      requirements: ['P1R'],
      constraints: [],
      acceptance: ['P1A'],
    },
    {
      id: 'P2',
      title: 'Second',
      dependsOn: ['P1'],
      requirements: ['P2R'],
      constraints: ['C2'],
      acceptance: ['P2A'],
    },
  ],
  remarks: null,
};

describe('renderPlanPhase', () => {
  it('renders the selected phase in the exact template shape', () => {
    const expected = [
      '# Test plan',
      '',
      '## Requirements',
      '- R1',
      '- R2',
      '',
      '## Constraints',
      '- None.',
      '',
      '## Phases',
      '- P1 — First',
      '- **P2 — Second** (selected phase)',
      '',
      '## Phase details',
      '',
      '### P2 — Second',
      '',
      '#### Depends on',
      '- P1',
      '',
      '#### Requirements',
      '- P2R',
      '',
      '#### Constraints',
      '- C2',
      '',
      '#### Acceptance criteria',
      '- P2A',
    ].join('\n');

    expect(renderPlanPhase(plan, 'P2')).toBe(expected);
  });

  it('returns null for an absent phase', () => {
    expect(renderPlanPhase(plan, 'P9')).toBeNull();
  });

  it('omits the Depends on block when the phase has no dependencies', () => {
    const output = renderPlanPhase(plan, 'P1');
    expect(output).not.toBeNull();
    expect(output).not.toContain('#### Depends on');
    expect(output).toContain('### P1 — First');
  });
});
