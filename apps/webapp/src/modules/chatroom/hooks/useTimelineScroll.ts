'use client';

import { useCallback, useEffect, useRef } from 'react';

import { TimelineScrollCoordinator } from './timelineScrollCoordinator';

/**
 * React hook for the virtualized timeline feed.
 *
 * Pin state is read via `useSyncExternalStore`; scroll policy lives in the coordinator ref.
 */
export function useTimelineScroll(): {
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  beginResize: () => void;
  endResize: () => void;
} {
  const coordinatorRef = useRef<TimelineScrollCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = new TimelineScrollCoordinator();
  }

  const coordinator = coordinatorRef as React.MutableRefObject<TimelineScrollCoordinator>;

  useEffect(() => {
    return () => coordinator.current.detach();
  }, [coordinator]);

  const beginResize = useCallback(() => {
    coordinator.current.beginResize();
  }, [coordinator]);

  const endResize = useCallback(() => {
    coordinator.current.endResize();
  }, [coordinator]);

  return { coordinator, beginResize, endResize };
}
