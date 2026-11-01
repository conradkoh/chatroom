'use client';

import { useEffect, useMemo } from 'react';

import { ConversationAnchorNavigator } from './ConversationAnchorNavigator';
import { ConversationMessageList } from './ConversationMessageList';
import { useConversation } from './hooks/useConversation';
import { QueuedMessagesIndicator } from '../../components/QueuedMessagesIndicator';
import { ComposerPreflightBar } from '../../components/timeline/ComposerPreflightBar';
import { useChatroomListing } from '../../context/ChatroomListingContext';
import { useHandoffNotification } from '../../hooks/useHandoffNotification';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

export type AllTabNavigationActions = {
  goToLatestAnchor: () => void;
};

export function ConversationPanel({
  chatroomId,
  onRegisterAllTabNavigation,
  onRequestComposerFocus,
}: {
  chatroomId: string;
  onRegisterAllTabNavigation?: (actions: AllTabNavigationActions) => void;
  onRequestComposerFocus?: () => void;
}) {
  const {
    events,
    messages,
    isLoading,
    isLoadingMore,
    canLoadMore,
    loadMore,
    hasPrev,
    hasNext,
    goToPrev,
    goToNext,
    anchorId,
    goToLatestAnchor,
    isOnLatestAnchor,
  } = useConversation(chatroomId);

  useEffect(() => {
    onRegisterAllTabNavigation?.({ goToLatestAnchor });
  }, [onRegisterAllTabNavigation, goToLatestAnchor]);

  const { chatrooms } = useChatroomListing();
  const notifyChatroom = useMemo(
    () => chatrooms?.find((c) => c._id === chatroomId),
    [chatrooms, chatroomId]
  );

  useHandoffNotification(messages, chatroomId, notifyChatroom);

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      <ConversationAnchorNavigator
        hasPrev={hasPrev}
        hasNext={hasNext}
        isOnLatestAnchor={isOnLatestAnchor}
        isLoading={isLoading}
        onPrev={goToPrev}
        onNext={goToNext}
        onJumpToLatest={goToLatestAnchor}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <ChatroomLoader />
        </div>
      ) : (
        <ConversationMessageList
          events={events}
          anchorId={anchorId}
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
