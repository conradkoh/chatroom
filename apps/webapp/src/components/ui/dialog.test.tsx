import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  stripOverflowFromClassName,
} from './dialog';

const mockReleaseBodyPointerLock = vi.fn();

vi.mock('@/modules/chatroom/components/shared/releaseBodyPointerLock', () => ({
  releaseBodyPointerLock: (...args: unknown[]) => mockReleaseBodyPointerLock(...args),
}));

vi.mock('@/hooks/useAllowTouchSelection', () => ({
  useAllowTouchSelection: vi.fn(),
}));

describe('Dialog', () => {
  beforeEach(() => {
    mockReleaseBodyPointerLock.mockClear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return window.setTimeout(() => (cb as FrameRequestCallback)(0), 0) as unknown as number;
    });
  });

  it('renders content when open', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test Title</DialogTitle>
          <DialogDescription>Test description</DialogDescription>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('releases body pointer lock when dialog closes', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test Title</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(mockReleaseBodyPointerLock).toHaveBeenCalled());
  });

  it('uses industrial modal tokens and strips content overflow utilities', () => {
    expect(stripOverflowFromClassName('max-h-96 overflow-hidden overflow-y-auto')).toBe('max-h-96');
    render(
      <Dialog open>
        <DialogContent className="overflow-hidden">
          <DialogTitle>Styled dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass(
      'fixed',
      'rounded-none',
      'bg-chatroom-bg-primary',
      'overflow-visible'
    );
    expect(dialog).not.toHaveClass('overflow-hidden');
  });

  it('supports escape and auto-focus compatibility callbacks', () => {
    const onEscapeKeyDown = vi.fn();
    const onOpenAutoFocus = vi.fn();
    render(
      <Dialog open>
        <DialogContent onEscapeKeyDown={onEscapeKeyDown} onOpenAutoFocus={onOpenAutoFocus}>
          <DialogTitle>Callbacks</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onEscapeKeyDown).toHaveBeenCalledTimes(1);
    expect(onOpenAutoFocus).toHaveBeenCalledTimes(1);
  });
});
