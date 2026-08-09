'use client';

import {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';

export type TimelineScrollResizeApi = {
  beginResize: () => void;
  endResize: () => void;
};

const TimelineScrollResizeContext =
  createContext<MutableRefObject<TimelineScrollResizeApi | null> | null>(null);

export function TimelineScrollResizeProvider({ children }: { children: ReactNode }) {
  const apiRef = useRef<TimelineScrollResizeApi | null>(null);
  return (
    <TimelineScrollResizeContext.Provider value={apiRef}>
      {children}
    </TimelineScrollResizeContext.Provider>
  );
}

/** AllTabMessageList calls this on mount to register scroll controller callbacks. */
export function useRegisterTimelineScrollResize(api: TimelineScrollResizeApi | null): void {
  const apiRef = useContext(TimelineScrollResizeContext);
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = api;
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [apiRef, api]);
}

/** MessageInput calls this to bracket composer height changes. */
export function useTimelineScrollResize(): TimelineScrollResizeApi | null {
  const apiRef = useContext(TimelineScrollResizeContext);
  // Ref writes don't trigger re-renders, so force one post-mount re-render to
  // observe an api registered by a sibling during the same commit.
  const [, setTick] = useState(0);
  useEffect(() => {
    setTick((t) => t + 1);
  }, []);
  return apiRef?.current ?? null;
}

/** Safe bracket helper for optional API. */
export function bracketTimelineScrollResize(
  api: TimelineScrollResizeApi | null,
  fn: () => void
): void {
  api?.beginResize();
  try {
    fn();
  } finally {
    api?.endResize();
  }
}
