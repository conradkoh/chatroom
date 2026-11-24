import { act, renderHook } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEphemeralAgentsExpanded } from './useEphemeralAgentsExpanded';

const ROOM_1 = 'room-1' as Id<'chatroom_rooms'>;
const ROOM_2 = 'room-2' as Id<'chatroom_rooms'>;
const ROOM_3 = 'room-3' as Id<'chatroom_rooms'>;

beforeEach(() => {
  localStorage.clear();
});

describe('useEphemeralAgentsExpanded', () => {
  it('defaults to collapsed when nothing is stored', () => {
    const { result } = renderHook(() => useEphemeralAgentsExpanded(ROOM_1));

    expect(result.current[0]).toBe(false);
  });

  it('persists expansion under a per-chatroom key', () => {
    const { result } = renderHook(() => useEphemeralAgentsExpanded(ROOM_1));

    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('chatroom:room-1:ephemeralAgentsExpanded')).toBe('true');
  });

  it('keeps expansion scoped per chatroom and restores it when returning', () => {
    const { result, rerender } = renderHook(
      ({ chatroomId }: { chatroomId: Id<'chatroom_rooms'> }) =>
        useEphemeralAgentsExpanded(chatroomId),
      { initialProps: { chatroomId: ROOM_1 } }
    );

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    rerender({ chatroomId: ROOM_2 });
    expect(result.current[0]).toBe(false);

    rerender({ chatroomId: ROOM_1 });
    expect(result.current[0]).toBe(true);
  });

  it('reads a previously stored expansion on first render', () => {
    localStorage.setItem('chatroom:room-3:ephemeralAgentsExpanded', JSON.stringify(true));

    const { result } = renderHook(() => useEphemeralAgentsExpanded(ROOM_3));

    expect(result.current[0]).toBe(true);
  });
});
