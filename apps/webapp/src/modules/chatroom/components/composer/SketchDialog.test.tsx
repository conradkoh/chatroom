import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SketchDialog } from './SketchDialog';

vi.mock('./useSketchCanvas', () => ({
  useSketchCanvas: () => ({
    canvasRef: { current: document.createElement('canvas') },
    bindCanvas: vi.fn(() => vi.fn()),
    brushSize: 3,
    setBrushSize: vi.fn(),
    hasContent: false,
    clear: vi.fn(),
    exportPngFile: vi.fn(),
  }),
}));

describe('SketchDialog', () => {
  it('shows the focused MVP controls and disables confirm when blank', () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear canvas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });
});
