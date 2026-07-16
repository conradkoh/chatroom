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
});
