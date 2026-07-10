'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { ChatroomDashboard } from '@/modules/chatroom';
import { ChatroomSidebar } from '@/modules/chatroom/components/ChatroomSidebar';
import { useChatroomListingSidebarVisible } from '@/modules/chatroom/hooks/persistence/useChatroomListingSidebarVisible';
import { useObserveChatroom } from '@/modules/chatroom/hooks/useObserveChatroom';

/**
 * Client body for /app/chatroom. Kept separate from page.tsx so the route can
 * wrap useSearchParams() in Suspense (avoids blocking the full app shell on RSC).
 */
export function ChatroomPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatroomId = searchParams.get('id');

  const handleBack = () => {
    router.push('/app');
  };

  const { refresh: refreshObservedChatroom } = useObserveChatroom(chatroomId);
  const [listingSidebarVisible, setListingSidebarVisible] = useChatroomListingSidebarVisible();

  const toggleListingSidebar = useCallback(() => {
    setListingSidebarVisible(!listingSidebarVisible);
  }, [listingSidebarVisible, setListingSidebarVisible]);

  if (!chatroomId) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#09090b',
          color: '#fafafa',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '0.875rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '1rem',
            }}
          >
            No Chatroom ID
          </h1>
          <p style={{ color: '#71717a', marginBottom: '1rem' }}>
            Please provide a chatroom ID via the <code style={{ color: '#34d399' }}>?id=</code>{' '}
            query parameter.
          </p>
          <button
            onClick={handleBack}
            style={{
              padding: '10px 20px',
              background: '#fafafa',
              color: '#09090b',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={cn(
          'chatroom-root hidden lg:flex flex-shrink-0 border-r-2 border-chatroom-border-strong bg-chatroom-bg-surface transition-all duration-200 overflow-hidden',
          listingSidebarVisible ? 'w-80' : 'w-0 border-r-0'
        )}
      >
        {listingSidebarVisible && <ChatroomSidebar activeChatroomId={chatroomId} />}
      </div>

      <div className="flex-1 min-w-0">
        <ChatroomDashboard
          key={chatroomId}
          chatroomId={chatroomId}
          onBack={handleBack}
          refreshObservedChatroom={refreshObservedChatroom}
          listingSidebarVisible={listingSidebarVisible}
          onToggleListingSidebar={toggleListingSidebar}
        />
      </div>
    </div>
  );
}
