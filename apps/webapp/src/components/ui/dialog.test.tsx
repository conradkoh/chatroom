import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

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
});
