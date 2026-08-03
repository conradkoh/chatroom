import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StandingInstructionsPickerRow } from './StandingInstructionsPickerRow';

describe('StandingInstructionsPickerRow', () => {
  it('uses standingInstructionDisplayTitle for primary line (empty title falls back to content)', () => {
    const content = 'Fallback headline\nbody line';
    render(<StandingInstructionsPickerRow title="" content={content} onSelect={vi.fn()} />);
    expect(screen.getByText('Fallback headline', { exact: true })).toHaveClass('font-medium');
    const contentLine = screen.getByText((_, el) =>
      Boolean(el?.classList.contains('text-chatroom-text-muted') && el.textContent === content)
    );
    expect(contentLine).toHaveClass('line-clamp-1');
    expect(contentLine).toHaveClass('break-words');
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

  it('label column has min-w-0 and flex-1; title and content both line-clamp-1', () => {
    render(
      <StandingInstructionsPickerRow title="Title" content="Content body" onSelect={vi.fn()} />
    );
    const titleLine = screen.getByText('Title');
    const contentLine = screen.getByText('Content body');
    const labelColumn = titleLine.parentElement;

    expect(labelColumn).toHaveClass('min-w-0');
    expect(labelColumn).toHaveClass('flex-1');
    expect(titleLine).toHaveClass('line-clamp-1');
    expect(titleLine).toHaveClass('break-words');
    expect(contentLine).toHaveClass('line-clamp-1');
    expect(contentLine).toHaveClass('break-words');
  });

  it('long content has line-clamp-1 and break-words classes', () => {
    const longContent =
      'This is a very long standing instruction that should truncate with ellipsis on a single line';
    render(
      <StandingInstructionsPickerRow title="Long rule" content={longContent} onSelect={vi.fn()} />
    );
    const contentLine = screen.getByText(longContent);
    expect(contentLine).toHaveClass('line-clamp-1');
    expect(contentLine).toHaveClass('break-words');
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
    expect(badge.closest('.line-clamp-1')).toBeNull();
  });

  it('does not render active badge when showActiveBadge is false', () => {
    render(<StandingInstructionsPickerRow title="Title" content="Content" onSelect={vi.fn()} />);
    expect(screen.queryByTestId('picker-row-end-adornment')).toBeNull();
  });

  it('renders edit and delete icons when handlers provided', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();
  });

  it('omits delete when only onEdit is provided', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        onSelect={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Edit')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('mobile renders edit button with min-h-8, min-w-8, and touch-manipulation', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        mobile
      />
    );
    const editButton = screen.getByLabelText('Edit');
    expect(editButton).toHaveClass('min-h-8');
    expect(editButton).toHaveClass('min-w-8');
    expect(editButton).toHaveClass('touch-manipulation');
  });

  it('desktop edit button uses fixed h-8 w-8 with centered icon padding', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        onSelect={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    const editButton = screen.getByLabelText('Edit');
    expect(editButton).toHaveClass('h-8');
    expect(editButton).toHaveClass('w-8');
    expect(editButton).toHaveClass('items-center');
    expect(editButton).toHaveClass('justify-center');
    expect(editButton).toHaveClass('p-1.5');
  });

  it('trailing actions container is vertically centered in the row', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const editButton = screen.getByLabelText('Edit');
    const container = editButton.parentElement;
    expect(container).toHaveClass('self-center');
    expect(container).toHaveClass('items-center');
  });

  it('mobile uses 14px icon size', () => {
    render(
      <StandingInstructionsPickerRow
        title="Title"
        content="Content"
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        mobile
      />
    );
    const icon = screen.getByLabelText('Edit').querySelector('svg');
    expect(icon).toHaveAttribute('width', '14');
    expect(icon).toHaveAttribute('height', '14');
  });
});
