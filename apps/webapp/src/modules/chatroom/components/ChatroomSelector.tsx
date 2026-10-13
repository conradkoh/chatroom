'use client';

import { MessageSquare } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { ChatroomBrowser } from './chatroom-selector/ChatroomBrowser';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';
import { NewChatroomWizard } from '../features/new-chatroom/NewChatroomWizard';
import { useChatroomListingStatuses } from '../hooks/useChatroomListingStatuses';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

interface ChatroomSelectorProps {
  onSelect: (chatroomId: string) => void;
}

function ChatroomLoadingState() {
  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <ChatroomLoader size="md" />
        <span className="text-chatroom-text-muted text-sm">Loading chatrooms...</span>
      </div>
    </div>
  );
}

/** Shown when the user has no chatrooms yet. */
function ChatroomEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      {/* Header */}
      <div className="mb-8 border-b-2 border-chatroom-border pb-6">
        <h1 className="text-lg font-bold uppercase tracking-widest mb-2">Welcome</h1>
        <p className="text-chatroom-text-muted text-sm">
          Create your first chatroom to get started
        </p>
      </div>
      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-16 text-chatroom-text-muted">
        <span className="text-5xl mb-6">
          <MessageSquare size={48} />
        </span>
        <button
          className="bg-chatroom-accent text-chatroom-bg-primary px-6 py-3 font-bold text-sm uppercase tracking-widest cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary"
          onClick={onCreate}
        >
          Create New Chatroom
        </button>
      </div>
    </div>
  );
}

function ChatroomListOrEmpty({
  chatrooms,
  statuses,
  onSelect,
  onCreate,
}: {
  chatrooms: ChatroomWithStatus[] | undefined;
  statuses: ReadonlyMap<string, ChatroomStatus>;
  onSelect: (chatroomId: string) => void;
  onCreate: () => void;
}) {
  if (!chatrooms || chatrooms.length === 0) {
    return <ChatroomEmptyState onCreate={onCreate} />;
  }
  return (
    <ChatroomBrowser
      chatrooms={chatrooms}
      statuses={statuses}
      onSelect={onSelect}
      onCreate={onCreate}
    />
  );
}

export function ChatroomSelector({ onSelect }: ChatroomSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showCreateForm = searchParams.get('create') === 'true';
  const { chatrooms, statuses, isLoading } = useChatroomListingStatuses();

  const handleOpenCreateForm = useCallback(() => {
    router.push('/app?create=true');
  }, [router]);

  const handleCancelCreateForm = useCallback(() => {
    router.back();
  }, [router]);

  if (isLoading) {
    return <ChatroomLoadingState />;
  }

  if (showCreateForm) {
    return (
      <div className="chatroom-root flex min-h-dvh items-start justify-center bg-chatroom-bg-primary text-chatroom-text-primary sm:p-6 sm:pt-12">
        <NewChatroomWizard onCreated={onSelect} onCancel={handleCancelCreateForm} />
      </div>
    );
  }

  return (
    <ChatroomListOrEmpty
      chatrooms={chatrooms}
      statuses={statuses}
      onSelect={onSelect}
      onCreate={handleOpenCreateForm}
    />
  );
}
