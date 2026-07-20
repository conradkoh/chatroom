/**
 * useTimelineScroll — per-scope coordinator isolation.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineScroll } from './useTimelineScroll';

describe('useTimelineScroll', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns different coordinators for different scroll scope keys', () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useTimelineScroll(scopeKey, 'room-1'),
      { initialProps: { scopeKey: 'all' } }
    );

    const allCoordinator = result.current.coordinator.current;
    rerender({ scopeKey: 'user-only' });
    const userCoordinator = result.current.coordinator.current;

    expect(userCoordinator).not.toBe(allCoordinator);
  });

  it('reuses the same coordinator when returning to a previous scope key', () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useTimelineScroll(scopeKey, 'room-1'),
      { initialProps: { scopeKey: 'all' } }
    );

    const allCoordinator = result.current.coordinator.current;
    rerender({ scopeKey: 'user-only' });
    rerender({ scopeKey: 'all' });

    expect(result.current.coordinator.current).toBe(allCoordinator);
  });

  it('clears scoped coordinators when chatroom changes', () => {
    const { result, rerender } = renderHook(
      ({ chatroomId }: { chatroomId: string }) => useTimelineScroll('all', chatroomId),
      { initialProps: { chatroomId: 'room-1' } }
    );

    const roomOneCoordinator = result.current.coordinator.current;
    rerender({ chatroomId: 'room-2' });
    const roomTwoCoordinator = result.current.coordinator.current;

    expect(roomTwoCoordinator).not.toBe(roomOneCoordinator);
  });
});
