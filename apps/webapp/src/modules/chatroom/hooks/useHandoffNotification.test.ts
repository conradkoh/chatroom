import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHandoffNotification } from './useHandoffNotification';

function makeMessage(
  overrides: Partial<{
    _id: string;
    type: string;
    senderRole: string;
    targetRole: string;
  }> = {}
) {
  return {
    _id: overrides._id ?? crypto.randomUUID(),
    type: overrides.type ?? 'handoff',
    senderRole: overrides.senderRole ?? 'planner',
    targetRole: overrides.targetRole ?? 'user',
  };
}

// ─── Mock: Notification (fallback path) ──────────────────────────────────────

const notificationCloseMock = vi.fn();
const notificationInstances: Array<{ body: string; tag: string; close: () => void }> = [];

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn().mockResolvedValue('granted' as const);

  body: string;
  tag: string;
  onclick: (() => void) | null = null;
  close = notificationCloseMock;

  constructor(_title: string, options?: { body?: string; tag?: string }) {
    this.body = options?.body ?? '';
    this.tag = options?.tag ?? '';
    notificationInstances.push(this);
  }
}

// ─── Mock: Service Worker ────────────────────────────────────────────────────

const swPostMessage = vi.fn();

function enableServiceWorker() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: { postMessage: swPostMessage },
      register: vi.fn().mockResolvedValue({}),
    },
  });
}

function disableServiceWorker() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: null,
      register: vi.fn().mockResolvedValue({}),
    },
  });
}

// ─── Visibility helpers ──────────────────────────────────────────────────────

let originalHidden: boolean;
let visibilityListeners: Array<() => void>;

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  for (const listener of visibilityListeners) {
    listener();
  }
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  visibilityListeners = [];
  const originalAdd = document.addEventListener.bind(document);
  const originalRemove = document.removeEventListener.bind(document);

  vi.spyOn(document, 'addEventListener').mockImplementation((event, handler, options?) => {
    if (event === 'visibilitychange') {
      visibilityListeners.push(handler as () => void);
    }
    return originalAdd(event, handler, options as any);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((event, handler, options?) => {
    if (event === 'visibilitychange') {
      visibilityListeners = visibilityListeners.filter((l) => l !== handler);
    }
    return originalRemove(event, handler, options as any);
  });

  originalHidden = document.hidden;
  setDocumentHidden(false);

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: MockNotification,
  });
  MockNotification.permission = 'granted';
  MockNotification.requestPermission.mockClear();
  notificationCloseMock.mockClear();
  notificationInstances.length = 0;
  swPostMessage.mockClear();

  // Default: SW available
  enableServiceWorker();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => originalHidden,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useHandoffNotification', () => {
  it('does not notify on initial load', () => {
    const initialMessages = [makeMessage(), makeMessage()];
    renderHook(() => useHandoffNotification(initialMessages));

    expect(swPostMessage).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(0);
  });

  it('sends notification via service worker when hidden and new handoff arrives', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const newMessage = makeMessage({ _id: 'new-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, newMessage] });

    expect(swPostMessage).toHaveBeenCalledWith({
      type: 'SHOW_NOTIFICATION',
      payload: {
        title: 'Chatroom Handoff',
        body: 'planner has handed off to you',
        tag: 'chatroom-handoff',
      },
    });
  });

  it('falls back to Notification API when SW is not available', () => {
    disableServiceWorker();

    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const newMessage = makeMessage({ _id: 'fb-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, newMessage] });

    expect(swPostMessage).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0]!.body).toBe('planner has handed off to you');
  });

  it('does not notify for non-handoff messages', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const chatMsg = makeMessage({ _id: 'chat-1', type: 'message', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, chatMsg] });

    expect(swPostMessage).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(0);
  });

  it('does not notify for handoffs to non-user roles', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const agentMsg = makeMessage({ _id: 'agent-1', type: 'handoff', targetRole: 'builder' });
    rerender({ msgs: [...initialMessages, agentMsg] });

    expect(swPostMessage).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(0);
  });

  it('does not duplicate notifications for the same message', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const newMsg = makeMessage({ _id: 'dup-1', type: 'handoff', targetRole: 'user' });
    const msgs2 = [...initialMessages, newMsg];
    rerender({ msgs: msgs2 });
    rerender({ msgs: msgs2 });

    expect(swPostMessage).toHaveBeenCalledTimes(1);
  });

  it('throttles rapid notifications', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const msg1 = makeMessage({ _id: 'rapid-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, msg1] });
    expect(swPostMessage).toHaveBeenCalledTimes(1);

    const msg2 = makeMessage({ _id: 'rapid-2', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, msg1, msg2] });
    // Throttled — still 1
    expect(swPostMessage).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const msg3 = makeMessage({ _id: 'rapid-3', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, msg1, msg2, msg3] });
    expect(swPostMessage).toHaveBeenCalledTimes(2);
  });

  it('does not notify when document is visible', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    // Document is visible (default)
    const newMsg = makeMessage({ _id: 'vis-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, newMsg] });

    expect(swPostMessage).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(0);
  });

  it('requests notification permission on mount', () => {
    MockNotification.permission = 'default';
    renderHook(() => useHandoffNotification([]));
    expect(MockNotification.requestPermission).toHaveBeenCalled();
  });
});
