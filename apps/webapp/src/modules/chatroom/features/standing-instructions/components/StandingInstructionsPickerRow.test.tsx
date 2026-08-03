import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StandingInstructionsPickerRow } from './StandingInstructionsPickerRow';

describe('StandingInstructionsPickerRow', () => {
  it('uses standingInstructionDisplayTitle for primary line (empty title falls back to content)', () => {
    const content = 'Fallback headline\nbody line';
    render(<StandingInstructionsPickerRow title="" content={content} onSelect={vi.fn()} />);
    expect(screen.getByText('Fallback headline', { exact: true })).toHaveClass('font-medium');
    const contentLine = screen.getByText(
      (_, el) => el?.classList.contains('text-chatroom-text-muted') && el.textContent === content
    );
    expect(contentLine).toHaveClass('truncate');
  });

  it('shows explicit title on primary line when provided', () => {
    render(
      <StandingInstructionsPickerRow
        title="Team rules"
        content="Always use TypeScript"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('Team rules')).toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
  });

  it('label column has min-w-0 and flex-1; inner spans have truncate', () => {
    render(
      <StandingInstructionsPickerRow title="Title" content="Content body" onSelect={vi.fn()} />
    );
    const titleLine = screen.getByText('Title');
    const contentLine = screen.getByText('Content body');
    const labelColumn = titleLine.parentElement;

    expect(labelColumn).toHaveClass('min-w-0');
    expect(labelColumn).toHaveClass('flex-1');
    expect(titleLine).toHaveClass('truncate');
    expect(contentLine).toHaveClass('truncate');
  });

  it('active badge renders via endAdornment outside truncated title line', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        showActiveBadge
        onSelect={vi.fn()}
      />
    );
    const badge = screen.getByTestId('picker-row-end-adornment');
    const titleLine = screen.getByText('Title');

    expect(badge).toHaveTextContent('Active');
    expect(titleLine).not.toContainElement(badge);
    expect(badge.closest('.truncate')).toBeNull();
  });

  it('does not render active badge when showActiveBadge is false', () => {
    render(<StandingInstructionsPickerRow title="Title" content="Content" onSelect={vi.fn()} />);
    expect(screen.queryByTestId('picker-row-end-adornment')).toBeNull();
  });
});
