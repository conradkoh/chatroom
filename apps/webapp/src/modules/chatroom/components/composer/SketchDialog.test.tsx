import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SketchDialog } from './SketchDialog';
const desktop = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop() }));
describe('SketchDialog', () => {
  it('blocks save on a blank canvas and labels tools', () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clear canvas' })).toBeTruthy();
  });
  it('shows and activates Select on desktop', async () => { render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />); const select=screen.getByRole('button',{name:'Select'}); expect(select).toBeInTheDocument(); await userEvent.click(select); expect(select).toHaveAttribute('aria-pressed','true'); });
  it('hides Select on mobile', () => { desktop.mockReturnValue(false); render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />); expect(screen.queryByRole('button',{name:'Select'})).not.toBeInTheDocument(); desktop.mockReturnValue(true); });
});
