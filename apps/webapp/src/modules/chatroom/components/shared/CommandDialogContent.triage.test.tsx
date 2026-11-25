import { act, render } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommandDialogContent, CommandDialogRoot } from './CommandDialogContent';

import { useTwoFingerTap } from '@/hooks/useTwoFingerTap';
import {
  closeContextManagedDialog,
  getChatroomSwitcherOpen,
  openContextManagedDialog,
  subscribeActiveContextManagedDialog,
} from '@/modules/chatroom/context/contextManagedDialogsController';

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: vi.fn(() => false) }));
vi.mock('@/hooks/useMobileKeyboard', () => ({ useVisualViewportOffsetTop: () => 0 }));

function Harness() {
  const open = useSyncExternalStore(
    subscribeActiveContextManagedDialog,
    getChatroomSwitcherOpen,
    () => false
  );
  useTwoFingerTap(() =>
    open ? closeContextManagedDialog() : openContextManagedDialog('switcher')
  );
  const [v, setV] = useState('');
  return (
    <CommandDialogRoot open={open}>
      <CommandDialogContent open={open}>
        <input data-slot="command-input" value={v} onChange={(e) => setV(e.target.value)} />
      </CommandDialogContent>
    </CommandDialogRoot>
  );
}

const t = (id: number, x: number) => ({
  identifier: id,
  clientX: x,
  clientY: 100,
  target: document.body,
});
function fire(type: string, touches: unknown[], changed: unknown[]) {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, 'touches', { value: touches });
  Object.defineProperty(e, 'changedTouches', { value: changed });
  act(() => void document.dispatchEvent(e));
}

describe('two-finger tap → switcher focus (jsdom)', () => {
  it('opens and focuses the input synchronously after touchend', () => {
    render(<Harness />);
    const a = t(0, 100);
    const b = t(1, 160);
    fire('touchstart', [a, b], [a, b]);
    fire('touchend', [], [a, b]);
    expect(getChatroomSwitcherOpen()).toBe(true);
    expect(document.activeElement?.getAttribute('data-slot')).toBe('command-input');
  });
});
