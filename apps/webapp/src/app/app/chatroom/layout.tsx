/**
 * Chatroom layout — prevents the parent <main> from scrolling.
 *
 * Safari aggressively scrolls parent elements to keep focused inputs visible.
 * The chatroom page manages its own scroll via the MessageFeed component.
 * Setting the parent <main> to overflow-hidden prevents Safari from
 * interfering with the chatroom's scroll management.
 */
'use client';

import { useEffect } from 'react';

export default function ChatroomLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;

    const prevOverflow = main.style.overflow;
    main.style.overflow = 'hidden';

    return () => {
      main.style.overflow = prevOverflow;
    };
  }, []);

  return <>{children}</>;
}
