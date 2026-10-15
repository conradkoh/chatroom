import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SketchFloatingSelectionMeta } from '../sketchDocument';
import { SketchEditorProperties, type SketchEditorPropertiesProps } from './SketchEditorProperties';

const HINT = 'Drag a handle to scale proportionally. Hold Shift to stretch freely.';

const floating: SketchFloatingSelectionMeta = {
  layerId: 'l',
  sourceWidth: 100,
  sourceHeight: 100,
  transform: { x: 20, y: 20, scaleX: 1, scaleY: 1, rotationRadians: 0 },
  originRect: null,
  provenance: 'selection',
  priorActiveLayerId: null,
};

const baseProps: SketchEditorPropertiesProps = {
  brushColor: '#171717',
  brushSize: 3,
  disabled: false,
  onBrushColorChange: vi.fn(),
  onBrushSizeChange: vi.fn(),
  activeTool: 'transform',
  selection: null,
  floating,
};

describe('SketchEditorProperties transform hint', () => {
  it('shows the proportional/Shift hint for transform with a floating selection', () => {
    render(<SketchEditorProperties {...baseProps} />);
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('hides the hint in move mode', () => {
    render(<SketchEditorProperties {...baseProps} activeTool="move" />);
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('hides the hint for transform without a floating selection', () => {
    render(
      <SketchEditorProperties
        {...baseProps}
        floating={null}
        selection={{ x: 20, y: 20, width: 100, height: 100 }}
      />
    );
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('hides the hint for transform with neither floating nor selection', () => {
    render(<SketchEditorProperties {...baseProps} floating={null} />);
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
