import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TimelinePlanSummary } from './TimelinePlanSummary';
import { getPlanSummary } from '../../timeline/planSummary';

/** The backend golden fixture, read from disk so this suite cannot drift from it. */
const PLAN_FIXTURE = readFileSync(
  resolve(
    __dirname,
    '../../../../../../../services/backend/src/domain/plan/__fixtures__/plan-v1.md'
  ),
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

function renderSummary(content: string) {
  return render(<TimelinePlanSummary summary={getPlanSummary(content)} previewId="preview-1" />);
}

describe('TimelinePlanSummary', () => {
  it('renders the fixture title, count and first phases', () => {
    renderSummary(PLAN_FIXTURE);

    expect(screen.getByTestId('timeline-plan-summary-title')).toHaveTextContent(
      'Add plan messages to the chatroom'
    );
    expect(screen.getByText('3 phases')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-summary-phases').textContent).toMatch(
      /P1 Schema and parser · P2 Backend write and read path · P3 Timeline rendering$/
    );
  });

  it('lists the first four phases of a 20-phase plan and counts the other 16', () => {
    renderSummary(planWithPhases(20));

    expect(screen.getByText('20 phases')).toBeInTheDocument();
    const phases = screen.getByTestId('timeline-plan-summary-phases');
    expect(phases.textContent).toMatch(/\+16 more$/);
    expect(phases.textContent).toContain('P4 ');
    expect(phases.textContent).not.toContain('P5');
  });

  it('renders a single phase as "1 phase" with no hidden count', () => {
    renderSummary(planWithPhases(1));

    expect(screen.getByText('1 phase')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-summary-phases').textContent).not.toContain('+ more');
  });

  it('renders the plain-text fallback for prose', () => {
    renderSummary('Just some prose, not a plan.');

    const fallback = screen.getByTestId('timeline-plan-preview-fallback');
    expect(fallback).toHaveTextContent('Just some prose, not a plan.');
    expect(fallback).toHaveAttribute('id', 'preview-1');
    expect(screen.queryByTestId('timeline-plan-summary-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-summary-phases')).not.toBeInTheDocument();
  });

  it('renders the Show full plan label for empty content', () => {
    renderSummary('   ');

    expect(screen.getByText('Show full plan')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-preview-fallback')).not.toBeInTheDocument();
  });

  it('uses only chatroom colour tokens', () => {
    const { container } = renderSummary(PLAN_FIXTURE);

    const hardCodedColour =
      /\b(?:bg|text|border|ring(?:-offset)?|fill|stroke|from|via|to|shadow|outline|decoration)-(?!chatroom-)(?:[a-z]+-\d{2,3}(?:\/\d+)?|white|black|transparent)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(?:oklch|hsl)\(/;
    const classes = Array.from(container.querySelectorAll<HTMLElement>('[class]'))
      .flatMap((node) => Array.from(node.classList))
      .join(' ');
    expect(classes).not.toBe('');
    expect(classes).not.toMatch(hardCodedColour);
  });
});
