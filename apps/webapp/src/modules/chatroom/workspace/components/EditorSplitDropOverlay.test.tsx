import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WORKSPACE_TAB_DRAG_MIME } from '../constants/workspaceTabDrag';

import { EditorSplitDropOverlay } from './EditorSplitDropOverlay';

function makeDataTransfer(types: string[], data: Record<string, string> = {}) {
  return {
    types,
    preventDefault: vi.fn(),
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: vi.fn(),
    getData: (type: string) => data[type] ?? '',
  } as unknown as DataTransfer;
}

describe('EditorSplitDropOverlay', () => {
  it('does not show overlay for non-workspace drags', () => {
    render(
      <EditorSplitDropOverlay onSplitDrop={vi.fn()}>
        <div data-testid="child">editor</div>
      </EditorSplitDropOverlay>
    );
    const container = screen.getByTestId('child').parentElement!;
    fireEvent.dragEnter(container, {
      dataTransfer: makeDataTransfer(['text/plain']),
    } as any);
    expect(screen.queryByTestId('editor-split-drop-overlay')).toBeNull();
  });

  it('shows overlay when dragging workspace tab', () => {
    render(
      <EditorSplitDropOverlay onSplitDrop={vi.fn()}>
        <div data-testid="child">editor</div>
      </EditorSplitDropOverlay>
    );
    const container = screen.getByTestId('child').parentElement!;
    fireEvent.dragEnter(container, {
      dataTransfer: makeDataTransfer([WORKSPACE_TAB_DRAG_MIME], {
        [WORKSPACE_TAB_DRAG_MIME]: 'tab-a',
      }),
      clientX: 50,
    } as any);
    expect(screen.getByTestId('editor-split-drop-overlay')).toBeTruthy();
  });

  it('calls onSplitDrop with tab key and right side', () => {
    const onSplitDrop = vi.fn();
    render(
      <EditorSplitDropOverlay onSplitDrop={onSplitDrop}>
        <div data-testid="child">editor</div>
      </EditorSplitDropOverlay>
    );
    const container = screen.getByTestId('child').parentElement!;
    fireEvent.drop(container, {
      dataTransfer: makeDataTransfer([WORKSPACE_TAB_DRAG_MIME], {
        [WORKSPACE_TAB_DRAG_MIME]: 'tab-b',
      }),
      clientX: 150,
    } as any);
    expect(onSplitDrop).toHaveBeenCalledWith('tab-b', 'right');
  });
});
