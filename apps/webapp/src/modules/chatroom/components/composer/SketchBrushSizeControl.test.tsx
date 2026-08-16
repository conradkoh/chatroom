import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SketchBrushSizeControl } from './SketchBrushSizeControl';

describe('SketchBrushSizeControl', () => {
  it('renders the value and reports slider changes', () => {
    const onChange = vi.fn();
    render(<SketchBrushSizeControl value={3} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Size' });
    expect(slider).toHaveValue('3');
    fireEvent.change(slider, { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith(10);
    expect(screen.getByText('3px')).toBeInTheDocument();
  });
});
