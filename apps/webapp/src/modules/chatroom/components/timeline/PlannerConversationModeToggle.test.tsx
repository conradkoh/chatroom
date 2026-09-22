import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlannerConversationModeToggle } from './PlannerConversationModeToggle';
import { ConversationModeProvider } from '../../hooks/useConversationMode';

let persistedMode: 'chat' | 'code' | 'code:enhanced' | null | undefined;
const setPersistedMode = vi.fn().mockResolvedValue(undefined);

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => persistedMode,
  useSessionMutation: () => setPersistedMode,
}));

describe('PlannerConversationModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderToggle(onRequestComposerFocus = vi.fn()) {
    render(
      <ConversationModeProvider chatroomId="room-1">
        <PlannerConversationModeToggle onRequestComposerFocus={onRequestComposerFocus} />
      </ConversationModeProvider>
    );
    return onRequestComposerFocus;
  }

  it('cycles provider state through Chat, Code, Enhance, then Chat', () => {
    renderToggle();

    const button = screen.getByTestId('planner-conversation-mode-toggle');
    expect(button).toHaveAttribute('aria-label', 'Mode: Chat');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-label', 'Mode: Code');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-label', 'Mode: Enhance');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-label', 'Mode: Chat');
    expect(setPersistedMode).toHaveBeenNthCalledWith(1, { chatroomId: 'room-1', mode: 'code' });
    expect(setPersistedMode).toHaveBeenNthCalledWith(2, {
      chatroomId: 'room-1',
      mode: 'code:enhanced',
    });
    expect(setPersistedMode).toHaveBeenNthCalledWith(3, { chatroomId: 'room-1', mode: 'chat' });
  });

  it('registers Ctrl/Alt+M and focuses after a shortcut cycle', () => {
    const onFocus = renderToggle();

    fireEvent.keyDown(window, { code: 'KeyM', ctrlKey: true });
    expect(screen.getByTestId('planner-conversation-mode-toggle')).toHaveAttribute(
      'aria-label',
      'Mode: Code'
    );
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
