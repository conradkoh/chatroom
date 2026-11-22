import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyButton } from './CopyButton';

// The clipboard is the only substituted port. Everything else is the real component.
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

async function clickButton(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

describe('CopyButton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the copied state for 2 s, then reverts to the copy label', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton text="hello" />);
    const button = screen.getByRole('button');

    await clickButton(button);

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(screen.getByText('Copied!')).toBeInTheDocument();
    expect(button.querySelector('svg.lucide-check')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByText('Copied!')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(button.querySelector('svg.lucide-check')).toBeNull();
  });

  it('renders no alert or status region on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton text="hello" />);
    await clickButton(screen.getByRole('button'));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a rejected write to onCopyError and does not show an error state', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);
    const onCopyError = vi.fn();

    render(<CopyButton text="hello" onCopyError={onCopyError} />);
    const button = screen.getByRole('button');

    await clickButton(button);

    expect(onCopyError).toHaveBeenCalledTimes(1);
    expect(onCopyError).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(button.querySelector('svg.lucide-check')).toBeNull();
    expect(button.querySelector('svg.lucide-circle-alert')).toBeNull();
  });

  it('shows the failed state for 2 s when there is no onCopyError sink', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);

    render(<CopyButton text="hello" />);
    const button = screen.getByRole('button');

    await clickButton(button);

    expect(button).toHaveAttribute('title', 'Failed to copy to clipboard');
    expect(button.querySelector('svg.lucide-circle-alert')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button).toHaveAttribute('title', 'Failed to copy to clipboard');

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(button).toHaveAttribute('title', 'Copy Copy');
    expect(button.querySelector('svg.lucide-circle-alert')).toBeNull();
  });

  it('does not update state when unmounted before the timer fires', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);

    const { unmount } = render(<CopyButton text="hello" />);
    await clickButton(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Failed to copy to clipboard');

    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    }).not.toThrow();
  });
});
