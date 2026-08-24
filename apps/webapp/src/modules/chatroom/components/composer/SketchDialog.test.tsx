import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import { SketchDialog } from './SketchDialog';

function setupCanvas(canvas: HTMLCanvasElement) {
  canvas.width = SKETCH_CANVAS_WIDTH;
  canvas.height = SKETCH_CANVAS_HEIGHT;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 300,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
    toBlob: {
      value: (cb: (blob: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
    },
  });
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});
function draw(canvas: HTMLCanvasElement) {
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      isPrimary: true,
    })
  );
  canvas.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true })
  );
}
describe('SketchDialog', () => {
  it('shows Eraser tool and activates it with E', async () => {
    const user = userEvent.setup();
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    const eraserTool = screen.getByRole('button', { name: 'Eraser tool' });
    expect(eraserTool).toHaveAttribute('aria-keyshortcuts', 'E');
    await user.keyboard('e');
    expect(eraserTool).toHaveAttribute('aria-pressed', 'true');
  });
  it('shows Brush tool with Photoshop shortcut semantics', () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    const brushTool = screen.getByRole('button', { name: 'Brush tool' });
    expect(brushTool).toHaveAttribute('aria-keyshortcuts', 'B');
    expect(brushTool).toHaveAttribute('aria-pressed', 'true');
  });
  it('shows MVP controls and disables confirm when blank', () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Color' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sketch canvas')).toHaveStyle({ backgroundColor: '#ffffff' });
    expect(screen.getByRole('button', { name: 'Add sketch' })).toBeDisabled();
  });
  it('enables Add sketch after pointer input', async () => {
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
    setupCanvas(canvas);
    await act(async () => draw(canvas));
    expect(screen.getByRole('button', { name: 'Add sketch' })).toBeEnabled();
  });
  it('resets to blank after close and reopen', async () => {
    const { rerender } = render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
    setupCanvas(canvas);
    await act(async () => draw(canvas));
    expect(screen.getByRole('button', { name: 'Add sketch' })).toBeEnabled();
    rerender(<SketchDialog open={false} onOpenChange={vi.fn()} onSave={vi.fn()} />);
    rerender(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add sketch' })).toBeDisabled();
  });
  it('calls onSave with exported file and dismisses on success', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(<SketchDialog open onOpenChange={onOpenChange} onSave={onSave} />);
    const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
    setupCanvas(canvas);
    await act(async () => draw(canvas));
    await userEvent.click(screen.getByRole('button', { name: 'Add sketch' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it('shows Select tool and selection overlay', async () => {
    const user = userEvent.setup();
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Select tool' })).toBeInTheDocument();
    expect(screen.getByTestId('sketch-selection-overlay')).toBeInTheDocument();
    await user.keyboard('m');
    expect(screen.getByRole('button', { name: 'Select tool' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeDisabled();
  });
  it('shows Delete selection control disabled until a marquee exists', async () => {
    const user = userEvent.setup();
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await user.keyboard('m');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeDisabled();
  });
  it('shows entire canvas status after Cmd+A in Select mode', async () => {
    const user = userEvent.setup();
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await user.keyboard('m');
    await user.keyboard('{Meta>}a{/Meta}');
    expect(screen.getByText('Entire canvas selected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeEnabled();
  });
  it('shows Delete selection on Move tool when a marquee exists', async () => {
    const user = userEvent.setup();
    render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await user.keyboard('m');
    const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
    setupCanvas(canvas);
    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 50,
          clientY: 50,
          isPrimary: true,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: 150,
          clientY: 120,
          isPrimary: true,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true })
      );
    });
    await user.keyboard('v');
    expect(screen.getByRole('button', { name: 'Move tool' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeEnabled();
  });
});
