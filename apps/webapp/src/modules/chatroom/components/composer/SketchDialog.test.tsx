import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SketchDialog } from './SketchDialog';
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
describe('SketchDialog', () => {
  it('blocks save on a blank canvas and labels tools', () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clear canvas' })).toBeTruthy();
  });
});
