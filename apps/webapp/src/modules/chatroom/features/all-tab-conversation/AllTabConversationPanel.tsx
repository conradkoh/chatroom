'use client';

import { useEffect, useMemo } from 'react';

import { AllTabAnchorNavigator } from './AllTabAnchorNavigator';
import { AllTabMessageList } from './AllTabMessageList';
import { useAllTabConversation } from './hooks/useAllTabConversation';
import { QueuedMessagesIndicator } from '../../components/QueuedMessagesIndicator';
import { ComposerPreflightBar } from '../../components/timeline/ComposerPreflightBar';
import type { MachineNameEntry } from '../../components/timeline/timelineRowStyles';
import { useChatroomListing } from '../../context/ChatroomListingContext';
import { useHandoffNotification } from '../../hooks/useHandoffNotification';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

export type AllTabNavigationActions = {
  goToLatestAnchor: () => void;
};

export function AllTabConversationPanel({
  chatroomId,
  machines,
  onRegisterAllTabNavigation,
  onRequestComposerFocus,
}: {
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
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
  } = useAllTabConversation(chatroomId);

  useEffect(() => {
    onRegisterAllTabNavigation?.({ goToLatestAnchor });
  }, [onRegisterAllTabNavigation, goToLatestAnchor]);

  const { chatrooms } = useChatroomListing();
  const notifyChatroom = useMemo(
    () => chatrooms?.find((c) => c._id === chatroomId),
    [chatrooms, chatroomId]
  );

  useHandoffNotification(
    useMemo(() => messages.map((m) => m), [messages]),
    chatroomId,
    notifyChatroom
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      <AllTabAnchorNavigator
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
        <AllTabMessageList
          events={events}
          anchorId={anchorId}
          machines={machines}
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
