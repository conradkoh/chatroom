'use client';

import { useCallback, useEffect, useRef } from 'react';

import { TimelineScrollCoordinator } from './timelineScrollCoordinator';

function getScopedCoordinator(
  coordinators: Map<string, TimelineScrollCoordinator>,
  scrollScopeKey: string
): TimelineScrollCoordinator {
  const existing = coordinators.get(scrollScopeKey);
  if (existing) return existing;

  const created = new TimelineScrollCoordinator();
  coordinators.set(scrollScopeKey, created);
  return created;
}

function clearCoordinators(coordinators: Map<string, TimelineScrollCoordinator>): void {
  for (const coordinator of coordinators.values()) {
    coordinator.detach();
  }
  coordinators.clear();
}

/**
 * React hook for the virtualized timeline feed.
 *
 * Pin state is read via `useSyncExternalStore`; scroll policy lives in the coordinator ref.
 * Each scroll scope key (e.g. message view mode tab) gets an isolated coordinator so tab
 * switches do not leak scroll offset or pin state.
 */
export function useTimelineScroll(
  scrollScopeKey: string,
  chatroomId?: string
): {
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  beginResize: () => void;
  endResize: () => void;
} {
  const coordinatorsRef = useRef<Map<string, TimelineScrollCoordinator>>(new Map());
  const prevChatroomIdRef = useRef<string | undefined>(chatroomId);

  if (chatroomId !== undefined && prevChatroomIdRef.current !== chatroomId) {
    clearCoordinators(coordinatorsRef.current);
    prevChatroomIdRef.current = chatroomId;
  }

  const coordinatorRef = useRef(getScopedCoordinator(coordinatorsRef.current, scrollScopeKey));
  coordinatorRef.current = getScopedCoordinator(coordinatorsRef.current, scrollScopeKey);

  useEffect(() => {
    const coordinators = coordinatorsRef.current;
    return () => clearCoordinators(coordinators);
  }, []);

  const beginResize = useCallback(() => {
    coordinatorRef.current.beginResize();
  }, []);

  const endResize = useCallback(() => {
    coordinatorRef.current.endResize();
  }, []);

  return { coordinator: coordinatorRef, beginResize, endResize };
}
