import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogTrigger } from './dialog';

describe('DialogContent z-index', () => {
  it('renders with z-50 (unified z-index band)', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogTrigger />
        <DialogContent data-testid="dialog-content">Content</DialogContent>
      </Dialog>
    );

    const content = screen.getByTestId('dialog-content');
    expect(content.className).toContain('z-50');
  });

  it('provides overlay portal container for nested pickers', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogTrigger />
        <DialogContent data-testid="dialog-content">
          <div data-testid="dialog-child">Content</div>
        </DialogContent>
      </Dialog>
    );

    expect(screen.getByTestId('dialog-child')).toBeInTheDocument();
    const content = screen.getByTestId('dialog-content');
    expect(content).toContainElement(screen.getByTestId('dialog-child'));
  });
});
