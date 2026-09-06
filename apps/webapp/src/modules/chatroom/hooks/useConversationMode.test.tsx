import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationModeProvider, useConversationMode } from './useConversationMode';

let mockServerIsActive: boolean | undefined = undefined;

vi.mock('../features/enhancers/hooks/useEnhancerConfig', () => ({
  useEnhancerConfig: () => ({
    config: null,
    isActive: false,
    serverIsActive: mockServerIsActive,
    saveConfig: vi.fn(),
    disable: vi.fn(),
  }),
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
    mockServerIsActive = undefined;
  });

  it('defaults to code mode', () => {
    mockServerIsActive = undefined;
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });

  it('seeds code:enhanced when server config is active', () => {
    mockServerIsActive = true;
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');
  });

  it('seeds code when server config is inactive', () => {
    mockServerIsActive = false;
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });

  it('user can set mode to chat', () => {
    mockServerIsActive = true;
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    act(() => {
      screen.getByTestId('set-chat').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
    expect(screen.getByTestId('has-user-selected')).toHaveTextContent('true');
  });

  it('user can set mode to code', () => {
    mockServerIsActive = true;
    render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );

    act(() => {
      screen.getByTestId('set-code').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });

  it('force code:enhanced when backend transitions disabled → enabled', () => {
    mockServerIsActive = false;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // User selects chat
    act(() => {
      screen.getByTestId('set-chat').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');

    // Backend enables — should force Enhanced regardless of user selection
    mockServerIsActive = true;
    rerender(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');
  });

  it('force code when backend transitions enabled → disabled while in Enhanced', () => {
    mockServerIsActive = true;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    // Backend disables — should force code since currently Enhanced
    mockServerIsActive = false;
    rerender(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });

  it('preserves chat when backend transitions enabled → disabled while in chat', () => {
    mockServerIsActive = true;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    // User switches to chat
    act(() => {
      screen.getByTestId('set-chat').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');

    // Backend disables — should preserve chat since not Enhanced
    mockServerIsActive = false;
    rerender(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
  });

  it('preserves code when backend transitions enabled → disabled while in code', () => {
    mockServerIsActive = true;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    // User switches to code
    act(() => {
      screen.getByTestId('set-code').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // Backend disables — should preserve code since not Enhanced
    mockServerIsActive = false;
    rerender(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });
});
