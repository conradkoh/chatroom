import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomSwitcher } from './ChatroomSwitcher';

import { CommandDialogProvider } from '@/modules/chatroom/context/CommandDialogContext';
import {
  getChatroomSwitcherOpen,
  resetContextManagedDialogsForTests,
} from '@/modules/chatroom/context/contextManagedDialogsController';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/chatroom',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/modules/chatroom/hooks/useChatroomListingStatuses', () => ({
  useChatroomListingStatuses: () => ({ chatrooms: [], isLoading: false, statuses: new Map() }),
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/hooks/useMobileKeyboard', () => ({ useVisualViewportOffsetTop: () => 0 }));

const COMMAND_INPUT_SELECTOR = '[data-slot="command-input"]';

// ── jsdom does not implement Touch/TouchEvent — build plain event-like objects ──

function makeTouch(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY, target: document.body };
}

function makeTouchEvent(type: string, touches: unknown[], changedTouches: unknown[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: unknown[];
    targetTouches: unknown[];
    changedTouches: unknown[];
  };
  Object.defineProperty(event, 'touches', { value: touches, configurable: true });
  Object.defineProperty(event, 'targetTouches', { value: touches, configurable: true });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches, configurable: true });
  return event;
}

function dispatchTouchEvent(type: string, touches: unknown[], changedTouches: unknown[]) {
  act(() => {
    document.dispatchEvent(makeTouchEvent(type, touches, changedTouches));
  });
}

function twoFingerTap() {
  const a = makeTouch(0, 100, 100);
  const b = makeTouch(1, 160, 100);
  dispatchTouchEvent('touchstart', [a, b], [a, b]);
  dispatchTouchEvent('touchend', [], [a, b]);
}

function cmdK() {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        bubbles: true,
        cancelable: true,
        metaKey: isMac,
        ctrlKey: !isMac,
      })
    );
  });
}

describe('ChatroomSwitcher two-finger tap', () => {
  let unmount: () => void;

  beforeEach(() => {
    resetContextManagedDialogsForTests();
  });

  afterEach(() => {
    unmount?.();
    resetContextManagedDialogsForTests();
  });

  it('opens the switcher and focuses the input inside the touchend dispatch', () => {
    ({ unmount } = render(
      <CommandDialogProvider>
        <ChatroomSwitcher />
      </CommandDialogProvider>
    ));

    // Registered after the hook's mount listener, so it observes the state the
    // hook's callback left behind during the same touchend dispatch.
    const recorded: { open?: boolean; active?: Element | null } = {};
    const observer = () => {
      recorded.open = getChatroomSwitcherOpen();
      recorded.active = document.activeElement;
    };
    document.addEventListener('touchend', observer, { capture: true });

    try {
      twoFingerTap();
    } finally {
      document.removeEventListener('touchend', observer, { capture: true });
    }

    const input = document.querySelector(COMMAND_INPUT_SELECTOR);

    expect(recorded.open).toBe(true);
    expect(recorded.active).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it('still opens the switcher with the input focused via Cmd+K', () => {
    ({ unmount } = render(
      <CommandDialogProvider>
        <ChatroomSwitcher />
      </CommandDialogProvider>
    ));

    cmdK();

    expect(getChatroomSwitcherOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector(COMMAND_INPUT_SELECTOR));
  });

  it('closes the switcher on a second two-finger tap', () => {
    ({ unmount } = render(
      <CommandDialogProvider>
        <ChatroomSwitcher />
      </CommandDialogProvider>
    ));

    twoFingerTap();
    expect(getChatroomSwitcherOpen()).toBe(true);

    twoFingerTap();
    expect(getChatroomSwitcherOpen()).toBe(false);
  });
});
