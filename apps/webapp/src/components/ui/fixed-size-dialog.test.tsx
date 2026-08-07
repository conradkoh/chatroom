import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './dialog';
import { FixedSizeDialog, FixedSizeDialogContent, FixedSizeDialogTitle } from './fixed-size-dialog';

vi.mock('@/hooks/useAllowTouchSelection', () => ({
  useAllowTouchSelection: vi.fn(),
}));

describe('FixedSizeDialog', () => {
  it('renders title and content when open', () => {
    render(
      <Dialog open>
        <FixedSizeDialog>
          <FixedSizeDialogTitle>Dialog Title</FixedSizeDialogTitle>
          <FixedSizeDialogContent>Dialog body</FixedSizeDialogContent>
        </FixedSizeDialog>
      </Dialog>
    );
    expect(screen.getByText('Dialog Title')).toBeInTheDocument();
    expect(screen.getByText('Dialog body')).toBeInTheDocument();
  });
});
