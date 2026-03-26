/**
 * Chatroom layout — prevents the parent <main> from scrolling.
 *
 * The chatroom page manages its own scroll via the MessageFeed component.
 * The parent <main> (in root layout) has overflow-auto for other pages,
 * but when the chatroom is active, we override it to overflow-hidden to
 * prevent the browser's native scroll-into-view behavior on the textarea
 * from scrolling the wrong container.
 */
'use client';

import { useEffect } from 'react';

export default function ChatroomLayout({ children }: { children: React.ReactNode }) {
  // On mount, set the parent <main> to overflow-hidden; restore on unmount
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
