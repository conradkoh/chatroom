import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetContent = vi.fn();
let captured: Record<string, unknown> | undefined;
let mockGetMarkdown = vi.fn(() => '');

vi.mock('@tiptap/react', () => ({
  useEditor: (options: Record<string, unknown>) => {
    captured = options;
    return {
      isDestroyed: false,
      commands: { setContent: mockSetContent, insertContent: vi.fn(), focus: vi.fn() },
      getMarkdown: mockGetMarkdown,
      chain: () => ({ setTextSelection: () => ({ focus: () => ({ run: vi.fn() }) }) }),
      view: { posAtCoords: () => null },
    };
  },
}));

import { useMarkdownEditor } from './useMarkdownEditor';

describe('useMarkdownEditor', () => {
  beforeEach(() => { vi.clearAllMocks(); captured = undefined; mockGetMarkdown = vi.fn(() => ''); });

  it('initializes editor with normalized markdown', () => {
    renderHook(() => useMarkdownEditor({ content: '<p>Legacy</p>', onUpdate: vi.fn() }));
    expect(captured?.content).toBe('Legacy');
  });

  it('calls onUpdate when legacy external content is synced', async () => {
    mockGetMarkdown = vi.fn(() => 'Current');
    const onUpdate = vi.fn();
    renderHook(() => useMarkdownEditor({ content: '<p>Legacy</p>', onUpdate }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('Legacy'));
  });

  it('syncs external content changes', async () => {
    mockGetMarkdown = vi.fn(() => 'Old');
    const { rerender } = renderHook(({ content }) => useMarkdownEditor({ content, onUpdate: vi.fn() }), { initialProps: { content: 'Old' } });
    mockGetMarkdown = vi.fn(() => 'Old');
    rerender({ content: '<p>New</p>' });
    await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('New', expect.anything()));
  });
});
