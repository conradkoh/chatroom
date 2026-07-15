import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogTrigger } from './dialog';

describe('DialogContent floating', () => {
  it('renders with z-[100] when floating is true', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogTrigger />
        <DialogContent floating data-testid="floating-dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const content = screen.getByTestId('floating-dialog');
    expect(content.className).toContain('z-[100]');
  });

  it('renders with z-50 when floating is not set', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogTrigger />
        <DialogContent data-testid="default-dialog">Content</DialogContent>
      </Dialog>
    );

    const content = screen.getByTestId('default-dialog');
    expect(content.className).toContain('z-50');
  });
});
