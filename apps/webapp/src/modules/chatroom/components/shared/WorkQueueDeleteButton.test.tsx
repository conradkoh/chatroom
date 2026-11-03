import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkQueueDeleteButton } from './WorkQueueDeleteButton';

describe('WorkQueueDeleteButton', () => {
  it('deletes on a single tap', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<WorkQueueDeleteButton onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('uses the supplied title', () => {
    render(<WorkQueueDeleteButton onDelete={vi.fn()} title="Remove prompt" />);

    expect(screen.getByRole('button', { name: 'Remove prompt' })).toHaveAttribute(
      'title',
      'Remove prompt'
    );
  });

  it('ignores taps while a delete is in flight and reports busy', async () => {
    let resolveDelete: (() => void) | undefined;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    render(<WorkQueueDeleteButton onDelete={onDelete} />);
    const button = screen.getByRole('button', { name: 'Delete' });

    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).not.toHaveAttribute('aria-busy');
  });
});
