import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useExplorerSelectionKeyboard } from './useExplorerSelectionKeyboard';

describe('useExplorerSelectionKeyboard', () => {
  it('calls onSendSelectionToComposer when Cmd+I is pressed with a selection inside the container', () => {
    const container = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'selected diff line';
    container.appendChild(paragraph);
    document.body.appendChild(container);

    const containerRef = createRef<HTMLDivElement>();
    Object.defineProperty(containerRef, 'current', { value: container, writable: true });

    const onSendSelectionToComposer = vi.fn();
    renderHook(() =>
      useExplorerSelectionKeyboard(
        containerRef,
        'git:commit:abc:file.ts',
        onSendSelectionToComposer
      )
    );

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = new KeyboardEvent('keydown', { key: 'i', metaKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(onSendSelectionToComposer).toHaveBeenCalledWith({
      filePath: 'git:commit:abc:file.ts',
      selectedText: 'selected diff line',
    });
    expect(preventDefault).toHaveBeenCalled();

    document.body.removeChild(container);
  });
});
