import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SketchEditorCanvasPanel } from './SketchEditorCanvasPanel';

const canvasOf = (container: HTMLElement) => container.querySelector('canvas');

describe('SketchEditorCanvasPanel manipulation cursor', () => {
  it('applies the manipulation cursor inline and drops cursor-crosshair', () => {
    const { container } = render(
      <SketchEditorCanvasPanel
        canvasRef={{ current: null }}
        canvasBindings={{}}
        activeTool="transform"
        manipulationCursor="nwse-resize"
      />
    );
    const canvas = canvasOf(container);
    expect(canvas?.style.cursor).toBe('nwse-resize');
    expect(canvas?.className).not.toContain('cursor-crosshair');
  });

  it('keeps cursor-crosshair when no manipulation cursor is supplied', () => {
    const { container } = render(
      <SketchEditorCanvasPanel
        canvasRef={{ current: null }}
        canvasBindings={{}}
        activeTool="transform"
      />
    );
    expect(canvasOf(container)?.className).toContain('cursor-crosshair');
  });

  it('keeps cursor-not-allowed and ignores the cursor when disabled', () => {
    const { container } = render(
      <SketchEditorCanvasPanel
        canvasRef={{ current: null }}
        canvasBindings={{}}
        activeTool="transform"
        disabled
        manipulationCursor="nwse-resize"
      />
    );
    const canvas = canvasOf(container);
    expect(canvas?.className).toContain('cursor-not-allowed');
    expect(canvas?.style.cursor).toBe('');
  });
});
