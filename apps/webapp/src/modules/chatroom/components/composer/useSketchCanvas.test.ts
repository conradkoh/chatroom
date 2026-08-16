import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSketchCanvas } from './useSketchCanvas';

describe('useSketchCanvas', () => {
  it('binds DPR canvas, tracks pen movement, clears, and exports PNG', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const canvas = document.createElement('canvas');
    const parent = document.createElement('div');
    parent.getBoundingClientRect = () => ({ width: 100, height: 80, left: 0, top: 0, right: 100, bottom: 80, x: 0, y: 0, toJSON: () => ({}) });
    parent.append(canvas);
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'releasePointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'hasPointerCapture', { value: vi.fn().mockReturnValue(false) });
    const ctx = { canvas, scale: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), getImageData: vi.fn(), putImageData: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 80, left: 10, top: 0, right: 110, bottom: 80, x: 10, y: 0, toJSON: () => ({}) });
    vi.spyOn(canvas, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
    const { result } = renderHook(() => useSketchCanvas());
    Object.defineProperty(result.current.canvasRef, 'current', { value: canvas, writable: true });
    act(() => result.current.bindCanvas(canvas));
    expect(canvas.width).toBe(200);
    act(() => { canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, pointerId: 1 })); canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, pointerId: 1 })); });
    expect(result.current.hasContent).toBe(true);
    act(() => result.current.clear());
    expect(result.current.hasContent).toBe(false);
    await expect(result.current.exportPngFile()).resolves.toMatchObject({ type: 'image/png' });
  });
});
