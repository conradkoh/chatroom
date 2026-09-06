import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_MODE_SERVER_DEBOUNCE_MS,
  ConversationModeProvider,
  useConversationMode,
} from './useConversationMode';

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

function rerenderRoom(rerender: (ui: React.ReactNode) => void, chatroomId: string) {
  rerender(
    <ConversationModeProvider chatroomId={chatroomId}>
      <ModeDisplay />
    </ConversationModeProvider>
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('ConversationModeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockServerIsActive = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('exposes a 2-second server reconciliation delay', () => {
    expect(CONVERSATION_MODE_SERVER_DEBOUNCE_MS).toBe(2_000);
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

  it('defers disabled → enabled until the server value is stable for 2s', () => {
    mockServerIsActive = false;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // Backend enables — rendered mode stays put during the quiet window.
    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS - 1);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(1);
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');
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

    // Backend enables — client selection stays visible until the delay elapses,
    // then backend authority forces Enhanced.
    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS);
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');
  });

  it('defers enabled → disabled until the server value is stable for 2s', () => {
    mockServerIsActive = true;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    // Backend disables — Enhanced stays visible during the quiet window.
    mockServerIsActive = false;
    rerenderRoom(rerender, 'room-1');
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS - 1);
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    advance(1);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
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
    rerenderRoom(rerender, 'room-1');
    // Still Enhanced before the debounce elapses.
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS);
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
    rerenderRoom(rerender, 'room-1');
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS);
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
    rerenderRoom(rerender, 'room-1');
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
  });

  it('reads the current client mode when the timer fires, not the stale pre-click mode', () => {
    mockServerIsActive = true;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    // Backend disables: at schedule time the effective mode is Enhanced.
    mockServerIsActive = false;
    rerenderRoom(rerender, 'room-1');
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');

    // User picks Chat mid-window; the click stays visible and must drive the
    // timer outcome (preserve Chat) instead of the stale Enhanced snapshot.
    act(() => {
      screen.getByTestId('set-chat').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS);
    expect(screen.getByTestId('mode')).toHaveTextContent('chat');
  });

  it('keeps a mid-window Code selection visible and lets it drive the toggle basis', () => {
    mockServerIsActive = true;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );

    mockServerIsActive = false;
    rerenderRoom(rerender, 'room-1');

    act(() => {
      screen.getByTestId('set-code').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // The preserved client selection remains the toggle basis afterwards.
    act(() => {
      screen.getByTestId('set-enhanced').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');
  });

  it('cancels the first transition when a second server value arrives before expiry', () => {
    mockServerIsActive = false;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // First transition: disabled → enabled.
    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS - 1_000);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // Second value before expiry replaces the pending timer.
    mockServerIsActive = false;
    rerenderRoom(rerender, 'room-1');

    // A full window from the FIRST value must not reconcile anything.
    advance(1_000);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    // Only the final stable value applies after its own complete window.
    advance(1_000);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies only the final value after rapid enable/disable/enable sequences', () => {
    mockServerIsActive = false;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );

    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    advance(500);

    mockServerIsActive = false;
    rerenderRoom(rerender, 'room-1');
    advance(500);

    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    // Intermediate values never rendered.
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS - 1);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(1);
    expect(screen.getByTestId('mode')).toHaveTextContent('code:enhanced');
  });

  it('clears the pending timer on unmount without post-unmount updates', () => {
    mockServerIsActive = false;
    const { rerender, unmount } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );

    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    // Advancing after unmount must not throw or leak a callback.
    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the previous room timer on chatroom change and seeds the new room immediately', () => {
    mockServerIsActive = false;
    const { rerender } = render(
      <ConversationModeProvider chatroomId="room-1">
        <ModeDisplay />
      </ConversationModeProvider>
    );

    // Pending disabled → enabled for room-1.
    mockServerIsActive = true;
    rerenderRoom(rerender, 'room-1');
    expect(vi.getTimerCount()).toBe(1);

    // Switching rooms seeds immediately from the new room's server value and
    // must not retain room-1's pending reconciliation.
    mockServerIsActive = false;
    rerenderRoom(rerender, 'room-2');
    expect(screen.getByTestId('mode')).toHaveTextContent('code');

    advance(CONVERSATION_MODE_SERVER_DEBOUNCE_MS * 2);
    expect(screen.getByTestId('mode')).toHaveTextContent('code');
    expect(vi.getTimerCount()).toBe(0);
  });
});
