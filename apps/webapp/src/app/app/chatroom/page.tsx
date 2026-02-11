'use client';

import { useSearchParams, useRouter } from 'next/navigation';

import { ChatroomDashboard } from '@/modules/chatroom';
import { ChatroomSidebar } from '@/modules/chatroom/components/ChatroomSidebar';

export default function ChatroomPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatroomId = searchParams.get('id');

  const handleBack = () => {
    router.push('/app');
  };

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
      {/* Left sidebar - chatroom list (desktop only) */}
      <div className="chatroom-root hidden lg:flex w-56 flex-shrink-0 border-r-2 border-chatroom-border-strong bg-chatroom-bg-surface">
        <ChatroomSidebar activeChatroomId={chatroomId} />
      </div>

      {/* Main chatroom area */}
      <div className="flex-1 min-w-0">
        <ChatroomDashboard chatroomId={chatroomId} onBack={handleBack} />
      </div>
    </div>
  );
}
