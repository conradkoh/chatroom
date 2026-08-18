import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SketchBrushSizeControl } from './SketchBrushSizeControl';

describe('SketchBrushSizeControl', () => {
  it('reports the selected brush size', () => {
    const onChange = vi.fn();
    render(<SketchBrushSizeControl value={3} onChange={onChange} />);

    fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } });

    expect(onChange).toHaveBeenCalledWith(8);
    expect(screen.getByText('3px')).toBeInTheDocument();
  });
});
