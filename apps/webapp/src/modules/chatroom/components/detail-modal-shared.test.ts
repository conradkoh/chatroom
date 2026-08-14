import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { exceededDragThreshold, hasNonEmptyTextSelection, useClickToEditHandlers } from './detail-modal-shared';

describe('click-to-edit handlers', () => {
  it('detects drag displacement and selection', () => {
    expect(exceededDragThreshold({ x: 0, y: 0 }, { clientX: 20, clientY: 0 })).toBe(true);
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected' } as Selection);
    expect(hasNonEmptyTextSelection()).toBe(true);
    selection.mockRestore();
  });

  it('enters only on an unselected plain click', () => {
    const enter = vi.fn();
    const { result } = renderHook(() => useClickToEditHandlers(enter));
    act(() => result.current.onMouseDown({ clientX: 0, clientY: 0 } as React.MouseEvent));
    act(() => result.current.onClick({ clientX: 0, clientY: 0, target: document.createElement('div') } as unknown as React.MouseEvent));
    expect(enter).toHaveBeenCalledTimes(1);
    act(() => result.current.onMouseDown({ clientX: 0, clientY: 0 } as React.MouseEvent));
    act(() => result.current.onClick({ clientX: 20, clientY: 0, target: document.createElement('div') } as unknown as React.MouseEvent));
    expect(enter).toHaveBeenCalledTimes(1);
  });
});
