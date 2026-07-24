import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HarnessModelConfigRow } from './HarnessModelConfigRow';

describe('HarnessModelConfigRow', () => {
  it('renders model on primary line and harness as subtitle', () => {
    render(
      <HarnessModelConfigRow
        harnessLabel="OpenCode (SDK)"
        modelLabel="MINIMAX M2.5 HIGHSPEED"
        starred
        onApply={vi.fn()}
        actions={<button type="button">Action</button>}
      />
    );

    expect(screen.getByText('MINIMAX M2.5 HIGHSPEED')).toBeInTheDocument();
    expect(screen.getByText('OpenCode (SDK)')).toBeInTheDocument();
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('calls onApply when label button clicked', () => {
    const onApply = vi.fn();
    render(
      <HarnessModelConfigRow
        harnessLabel="Claude Code"
        modelLabel="Claude Opus 4"
        onApply={onApply}
        actions={null}
      />
    );

    fireEvent.click(screen.getByText('Claude Opus 4'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('sets full label on title attribute', () => {
    render(
      <HarnessModelConfigRow
        harnessLabel="OpenCode (SDK)"
        modelLabel="MINIMAX M2.5"
        onApply={vi.fn()}
        actions={null}
      />
    );

    expect(screen.getByTitle('OpenCode (SDK) / MINIMAX M2.5')).toBeInTheDocument();
  });
});
