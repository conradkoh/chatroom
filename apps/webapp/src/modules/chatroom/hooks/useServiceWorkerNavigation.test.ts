import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useServiceWorkerNavigation } from './useServiceWorkerNavigation';

// ─── Mock: useRouter ──────────────────────────────────────────────────────────
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

// ─── Mock: navigator.serviceWorker message events ─────────────────────────────
type MessageHandler = (event: MessageEvent) => void;
let swMessageHandlers: MessageHandler[] = [];

function postServiceWorkerMessage(data: unknown) {
  const event = new MessageEvent('message', { data });
  for (const handler of swMessageHandlers) {
    handler(event);
  }
}

function enableServiceWorker() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: { postMessage: vi.fn() },
      register: vi.fn().mockResolvedValue({}),
      addEventListener: vi.fn((event: string, handler: EventListenerOrEventListenerObject) => {
        if (event === 'message') {
          swMessageHandlers.push(handler as MessageHandler);
        }
      }),
      removeEventListener: vi.fn((event: string, handler: EventListenerOrEventListenerObject) => {
        if (event === 'message') {
          swMessageHandlers = swMessageHandlers.filter((h) => h !== handler);
        }
      }),
    },
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  replaceMock.mockClear();
  swMessageHandlers = [];
  enableServiceWorker();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useServiceWorkerNavigation', () => {
  it('attaches a message listener on mount', () => {
    renderHook(() => useServiceWorkerNavigation());

    expect(navigator.serviceWorker.addEventListener).toHaveBeenCalledWith(
      'message',
      expect.any(Function)
    );
  });

  it('removes the message listener on unmount', () => {
    const { unmount } = renderHook(() => useServiceWorkerNavigation());
    const handler = swMessageHandlers[0];

    unmount();

    expect(navigator.serviceWorker.removeEventListener).toHaveBeenCalledWith('message', handler);
    expect(swMessageHandlers).not.toContain(handler);
  });

  it('navigates to chatroom on NAVIGATE_TO_CHATROOM message', () => {
    renderHook(() => useServiceWorkerNavigation());

    act(() => {
      postServiceWorkerMessage({
        type: 'NAVIGATE_TO_CHATROOM',
        chatroomId: 'room-123',
      });
    });

    expect(replaceMock).toHaveBeenCalledWith('/app/chatroom?id=room-123', {
      scroll: false,
    });
  });

  it('ignores messages with unknown type', () => {
    renderHook(() => useServiceWorkerNavigation());

    act(() => {
      postServiceWorkerMessage({ type: 'PONG', version: '1.0.0' });
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('ignores messages missing type field', () => {
    renderHook(() => useServiceWorkerNavigation());

    act(() => {
      postServiceWorkerMessage({ chatroomId: 'room-123' });
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
