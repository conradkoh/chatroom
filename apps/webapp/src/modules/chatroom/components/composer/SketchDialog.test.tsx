import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SketchDialog } from './SketchDialog';

vi.mock('./useSketchCanvas', () => ({
  useSketchCanvas: () => ({
    canvasRef: { current: document.createElement('canvas') },
    bindCanvas: vi.fn(() => vi.fn()),
    brushColor: '#171717',
    setBrushColor: vi.fn(),
    brushSize: 3,
    setBrushSize: vi.fn(),
    hasContent: false,
    exportPngFile: vi.fn(),
  }),
}));

describe('SketchDialog', () => {
  it('shows the focused MVP controls and disables confirm when blank', () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Color' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sketch canvas')).toHaveStyle({ backgroundColor: '#ffffff' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sketch' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Clear canvas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });
});
