import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SketchDeleteSelectionDialog } from './SketchDeleteSelectionDialog';

describe('SketchDeleteSelectionDialog', () => {
  it('describes partial and full-canvas deletion scope', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <SketchDeleteSelectionDialog
        open
        selection={{ x: 10, y: 20, width: 100, height: 80 }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByText(/100 × 80 px area/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete pixels' }));
    expect(onConfirm).toHaveBeenCalled();
    rerender(
      <SketchDeleteSelectionDialog
        open
        selection={{ x: 0, y: 0, width: 1200, height: 900 }}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText(/entire 1200 × 900 canvas/)).toBeInTheDocument();
  });
});
