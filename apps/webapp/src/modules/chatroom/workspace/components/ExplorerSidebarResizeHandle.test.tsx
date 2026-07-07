import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExplorerSidebarResizeHandle } from './ExplorerSidebarResizeHandle';

function dispatchWindowPointerEvent(
  type: 'pointermove' | 'pointerup',
  init: { pointerId: number; clientX?: number; buttons?: number }
) {
  window.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
}

describe('ExplorerSidebarResizeHandle', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it('updates width on pointer drag', () => {
    const onWidthChange = vi.fn();
    render(<ExplorerSidebarResizeHandle widthPx={256} onWidthChange={onWidthChange} />);
    const handle = screen.getByRole('separator');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, button: 0 });
    dispatchWindowPointerEvent('pointermove', { pointerId: 1, clientX: 150, buttons: 1 });
    expect(onWidthChange).toHaveBeenCalledWith(306);

    dispatchWindowPointerEvent('pointerup', { pointerId: 1 });
  });

  it('captures and releases pointer on the handle element', () => {
    const onWidthChange = vi.fn();
    render(<ExplorerSidebarResizeHandle widthPx={256} onWidthChange={onWidthChange} />);
    const handle = screen.getByRole('separator');
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    handle.setPointerCapture = setCapture;
    handle.releasePointerCapture = releaseCapture;

    fireEvent.pointerDown(handle, { pointerId: 42, clientX: 100, button: 0 });
    expect(setCapture).toHaveBeenCalledWith(42);

    dispatchWindowPointerEvent('pointerup', { pointerId: 42 });
    expect(releaseCapture).toHaveBeenCalledWith(42);
  });

  it('clamps width to min/max during drag', () => {
    const onWidthChange = vi.fn();
    render(<ExplorerSidebarResizeHandle widthPx={256} onWidthChange={onWidthChange} />);
    const handle = screen.getByRole('separator');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, button: 0 });
    dispatchWindowPointerEvent('pointermove', { pointerId: 1, clientX: -200, buttons: 1 });
    expect(onWidthChange).toHaveBeenLastCalledWith(180);

    dispatchWindowPointerEvent('pointerup', { pointerId: 1 });
  });
});
