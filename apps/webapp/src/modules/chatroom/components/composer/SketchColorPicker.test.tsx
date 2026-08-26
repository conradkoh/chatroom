import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SketchColorPicker } from './SketchColorPicker';
describe('SketchColorPicker', () => {
  it('selects colors and marks the active swatch', async () => {
    const onChange = vi.fn();
    render(<SketchColorPicker value="#171717" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Brush color Black' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Brush color Red' }));
    expect(onChange).toHaveBeenCalledWith('#ef4444');
  });
  it('disables all swatches', () => {
    render(<SketchColorPicker value="#171717" onChange={vi.fn()} disabled />);
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(
      true
    );
  });
});
