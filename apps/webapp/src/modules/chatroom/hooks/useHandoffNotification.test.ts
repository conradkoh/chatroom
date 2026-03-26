import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHandoffNotification } from './useHandoffNotification';

// ---------- helpers ----------

function makeMessage(
  overrides: Partial<{
    _id: string;
    type: string;
    senderRole: string;
    targetRole: string;
    _creationTime: number;
  }> = {}
) {
  return {
    _id: overrides._id ?? crypto.randomUUID(),
    type: overrides.type ?? 'handoff',
    senderRole: overrides.senderRole ?? 'planner',
    targetRole: overrides.targetRole ?? 'user',
    _creationTime: overrides._creationTime ?? Date.now(),
  };
}

// ---------- mocks ----------

const notificationCloseMock = vi.fn();
const notificationInstances: Array<{ body: string; tag: string; close: () => void }> = [];

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn().mockResolvedValue('granted' as const);

  body: string;
  tag: string;
  onclick: (() => void) | null = null;
  close = notificationCloseMock;

  constructor(
    _title: string,
    options?: { body?: string; tag?: string }
  ) {
    this.body = options?.body ?? '';
    this.tag = options?.tag ?? '';
    notificationInstances.push(this);
  }
}

// ---------- setup / teardown ----------

let originalHidden: boolean;
let visibilityListeners: Array<() => void>;

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  // Fire listeners so the ref updates
  for (const listener of visibilityListeners) {
    listener();
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  // Track visibilitychange listeners
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

  // Start with document visible
  originalHidden = document.hidden;
  setDocumentHidden(false);

  // Install Notification mock
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: MockNotification,
  });
  MockNotification.permission = 'granted';
  MockNotification.requestPermission.mockClear();
  notificationCloseMock.mockClear();
  notificationInstances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => originalHidden,
  });
});

// ---------- tests ----------

describe('useHandoffNotification', () => {
  it('does NOT fire notification on initial load (marks existing messages as seen)', () => {
    const initialMessages = [makeMessage(), makeMessage()];

    renderHook(() => useHandoffNotification(initialMessages));

    expect(notificationInstances).toHaveLength(0);
  });

  it('fires notification for new handoff to user when document is hidden', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    // Tab becomes hidden
    setDocumentHidden(true);

    // New handoff arrives
    const newMessage = makeMessage({ _id: 'new-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, newMessage] });

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].body).toContain('planner');
  });

  it('does NOT fire notification for non-handoff messages', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const chatMsg = makeMessage({ _id: 'chat-1', type: 'message', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, chatMsg] });

    expect(notificationInstances).toHaveLength(0);
  });

  it('does NOT fire notification for handoff to non-user role', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const agentMsg = makeMessage({ _id: 'agent-1', type: 'handoff', targetRole: 'builder' });
    rerender({ msgs: [...initialMessages, agentMsg] });

    expect(notificationInstances).toHaveLength(0);
  });

  it('does NOT fire duplicate notifications for same message ID', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    const newMsg = makeMessage({ _id: 'dup-1', type: 'handoff', targetRole: 'user' });
    const msgs2 = [...initialMessages, newMsg];

    // First rerender — should fire
    rerender({ msgs: msgs2 });
    expect(notificationInstances).toHaveLength(1);

    // Second rerender with same messages — should NOT fire again
    rerender({ msgs: [...msgs2] });
    expect(notificationInstances).toHaveLength(1);
  });

  it('throttles: rapid messages within 3s only fire one notification', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    setDocumentHidden(true);

    // First new handoff — fires
    const msg1 = makeMessage({ _id: 'rapid-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, msg1] });
    expect(notificationInstances).toHaveLength(1);

    // Second handoff immediately after — throttled
    const msg2 = makeMessage({ _id: 'rapid-2', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, msg1, msg2] });
    expect(notificationInstances).toHaveLength(1);

    // Advance time past throttle window
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Third handoff after throttle — fires
    const msg3 = makeMessage({ _id: 'rapid-3', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, msg1, msg2, msg3] });
    expect(notificationInstances).toHaveLength(2);
  });

  it('does NOT fire notification when document is visible', () => {
    const initialMessages = [makeMessage({ _id: 'init-1' })];
    const { rerender } = renderHook(
      ({ msgs }) => useHandoffNotification(msgs),
      { initialProps: { msgs: initialMessages } }
    );

    // Document is visible (default)
    const newMsg = makeMessage({ _id: 'vis-1', type: 'handoff', targetRole: 'user' });
    rerender({ msgs: [...initialMessages, newMsg] });

    expect(notificationInstances).toHaveLength(0);
  });

  it('requests notification permission on mount when permission is default', () => {
    MockNotification.permission = 'default';

    renderHook(() => useHandoffNotification([]));

    expect(MockNotification.requestPermission).toHaveBeenCalled();
  });

  it('does NOT request permission when already granted', () => {
    MockNotification.permission = 'granted';

    renderHook(() => useHandoffNotification([]));

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });
});
