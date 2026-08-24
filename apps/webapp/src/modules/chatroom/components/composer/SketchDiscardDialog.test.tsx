import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SketchDiscardDialog } from './SketchDiscardDialog';

describe('SketchDiscardDialog', () => {
  it('shows discard copy and confirms', async () => {
    const onConfirm = vi.fn();
    render(<SketchDiscardDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard sketch?');
    await userEvent.click(screen.getByRole('button', { name: 'Discard sketch' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancel does not confirm', async () => {
    const onConfirm = vi.fn();
    render(<SketchDiscardDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
