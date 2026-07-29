'use client';

import { useRouter } from 'next/navigation';

import { ChatroomSelector } from '@/modules/chatroom';
import { navigateWithAppPageTransition } from '@/lib/appPageTransition';

/**
 * Main application page - displays the chatroom list.
 */
export default function AppPage() {
  const router = useRouter();

  const handleSelectChatroom = (chatroomId: string) => {
    navigateWithAppPageTransition(router, `/app/chatroom?id=${chatroomId}`, 'forward');
  };

  return <ChatroomSelector onSelect={handleSelectChatroom} />;
}
