'use client';

import { useEffect, useMemo } from 'react';

import { ConversationMessageList } from './ConversationMessageList';
import { useConversation } from './hooks/useConversation';
import { PageNavigator } from './PageNavigator';
import { QueuedMessagesIndicator } from '../../components/QueuedMessagesIndicator';
import { ComposerPreflightBar } from '../../components/timeline/ComposerPreflightBar';
import { useChatroomListing } from '../../context/ChatroomListingContext';
import { useHandoffNotification } from '../../hooks/useHandoffNotification';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

export type ConversationNavigationActions = {
  goToLatestPage: () => void;
};

export function ConversationPanel({
  chatroomId,
  onRegisterConversationNavigation,
  onRequestComposerFocus,
}: {
  chatroomId: string;
  onRegisterConversationNavigation?: (actions: ConversationNavigationActions) => void;
  onRequestComposerFocus?: () => void;
}) {
  const {
    events,
    messages,
    isLoading,
    isLoadingMore,
    canLoadMore,
    loadMore,
    hasPrevPage,
    hasNextPage,
    goToPrevPage,
    goToNextPage,
    pageId,
    goToLatestPage,
    isOnLatestPage,
  } = useConversation(chatroomId);

  useEffect(() => {
    onRegisterConversationNavigation?.({ goToLatestPage });
  }, [onRegisterConversationNavigation, goToLatestPage]);

  const { chatrooms } = useChatroomListing();
  const notifyChatroom = useMemo(
    () => chatrooms?.find((c) => c._id === chatroomId),
    [chatrooms, chatroomId]
  );

  useHandoffNotification(messages, chatroomId, notifyChatroom);

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      <PageNavigator
        hasPrevPage={hasPrevPage}
        hasNextPage={hasNextPage}
        isOnLatestPage={isOnLatestPage}
        isLoading={isLoading}
        onPrev={goToPrevPage}
        onNext={goToNextPage}
        onJumpToLatest={goToLatestPage}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <ChatroomLoader />
        </div>
      ) : (
        <ConversationMessageList
          events={events}
          pageId={pageId}
          canLoadMore={canLoadMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
        />
      )}

      <ComposerPreflightBar
        chatroomId={chatroomId as never}
        onRequestComposerFocus={onRequestComposerFocus}
      />

      <QueuedMessagesIndicator chatroomId={chatroomId as never} />
    </div>
  );
}
