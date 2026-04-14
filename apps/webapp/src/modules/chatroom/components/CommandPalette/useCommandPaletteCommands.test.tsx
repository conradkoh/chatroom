import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCommandPaletteCommands } from './useCommandPaletteCommands';

describe('useCommandPaletteCommands', () => {
  const baseProps = {
    onOpenSettings: vi.fn(),
    onOpenEventStream: vi.fn(),
    onOpenGitPanel: vi.fn(),
    onOpenGitPanelDiff: vi.fn(),
    onOpenBacklog: vi.fn(),
    onOpenPendingReview: vi.fn(),
    onOpenChatroomSwitcher: vi.fn(),
    onOpenFileSelector: vi.fn(),
  };

  it('adds a New Chatroom navigation command when a callback is provided', () => {
    const onCreateNewChatroom = vi.fn();

    const { result } = renderHook(() =>
      useCommandPaletteCommands({
        ...baseProps,
        onCreateNewChatroom,
      })
    );

    const navigateCommands = result.current.filter((command) => command.category === 'Navigate');

    expect(navigateCommands.map((command) => command.id)).toEqual([
      'nav-switch-chatroom',
      'nav-new-chatroom',
      'nav-go-to-file',
    ]);

    const newChatroomCommand = navigateCommands.find((command) => command.id === 'nav-new-chatroom');
    expect(newChatroomCommand).toMatchObject({
      label: 'Chatroom: New Chatroom',
      keywords: ['new', 'create', 'chatroom'],
    });

    newChatroomCommand?.action();
    expect(onCreateNewChatroom).toHaveBeenCalledTimes(1);
  });

  it('omits the New Chatroom command when no callback is provided', () => {
    const { result } = renderHook(() => useCommandPaletteCommands(baseProps));

    expect(result.current.some((command) => command.id === 'nav-new-chatroom')).toBe(false);
  });
});
