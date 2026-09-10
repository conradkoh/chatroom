import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationModeProvider, useConversationMode } from './useConversationMode';

let mockPersistedMode: 'chat' | 'code' | 'code:enhanced' | null | undefined;
const mockSetPersistedMode = vi.fn().mockResolvedValue(undefined);

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mockPersistedMode,
  useSessionMutation: () => mockSetPersistedMode,
}));

function ModeDisplay() {
  const { mode, setMode, hasUserSelected } = useConversationMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="has-user-selected">{String(hasUserSelected)}</span>
      <button data-testid="set-chat" onClick={() => setMode('chat')} />
      <button data-testid="set-code" onClick={() => setMode('code')} />
      <button data-testid="set-enhanced" onClick={() => setMode('code:enhanced')} />
    </div>
  );
}

describe('ConversationModeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistedMode = undefined;
  });

  afterEach(() => cleanup());

  it('defaults to chat while the backend preference is loading', () => {
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
  });

  it('hydrates the persisted mode from the backend', () => {
    mockPersistedMode = 'code';
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });

  it('keeps chat when no persisted preference exists', () => {
    mockPersistedMode = null;
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
  });

  it('optimistically updates and persists a user selection', () => {
    mockPersistedMode = 'code';
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );

    act(() => screen.getByTestId('set-chat').click());

    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
    expect(screen.getByTestId('has-user-selected')).toHaveTextContent('true');
    expect(mockSetPersistedMode).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      mode: 'chat',
    });
  });

  it('resets to chat while hydrating a different chatroom', () => {
    mockPersistedMode = 'code';
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    act(() => screen.getByTestId('set-enhanced').click());

    mockPersistedMode = null;
    rerender(
      <ConversationModeProvider chatroomId="room-2">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
  });
});
