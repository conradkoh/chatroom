'use client';

import { useRouter } from 'next/navigation';

import { ChatroomSelector } from '@/modules/chatroom';
import '@/modules/chatroom/styles/index.css';

/**
 * Main application page - displays the chatroom list.
 */
export default function AppPage() {
  const router = useRouter();

  const handleSelectChatroom = (chatroomId: string) => {
    router.push(`/app/chatroom?id=${chatroomId}`);
  };

  return <ChatroomSelector onSelect={handleSelectChatroom} />;
}
