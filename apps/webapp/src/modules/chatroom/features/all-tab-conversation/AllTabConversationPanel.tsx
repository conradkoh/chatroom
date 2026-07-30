'use client';

import { useEffect, useMemo } from 'react';

import { AllTabAnchorNavigator } from './AllTabAnchorNavigator';
import { AllTabMessageList } from './AllTabMessageList';
import { useAllTabConversation } from './hooks/useAllTabConversation';
import { QueuedMessagesIndicator } from '../../components/QueuedMessagesIndicator';
import { ComposerPreflightBar } from '../../components/timeline/ComposerPreflightBar';
import type { MachineNameEntry } from '../../components/timeline/timelineRowStyles';
import { useHandoffNotification } from '../../hooks/useHandoffNotification';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

export type AllTabNavigationActions = {
  goToLatestAnchor: () => void;
};

export function AllTabConversationPanel({
  chatroomId,
  machines,
  onRegisterAllTabNavigation,
}: {
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  onRegisterAllTabNavigation?: (actions: AllTabNavigationActions) => void;
}) {
  const {
    events,
    messages,
    isLoading,
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

  useHandoffNotification(
    useMemo(() => messages.map((m) => m), [messages]),
    chatroomId
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <ChatroomLoader />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      <AllTabAnchorNavigator
        hasPrev={hasPrev}
        hasNext={hasNext}
        isOnLatestAnchor={isOnLatestAnchor}
        onPrev={goToPrev}
        onNext={goToNext}
        onJumpToLatest={goToLatestAnchor}
      />

      <AllTabMessageList events={events} anchorId={anchorId} machines={machines} />

      <ComposerPreflightBar chatroomId={chatroomId as never} />

      <QueuedMessagesIndicator chatroomId={chatroomId as never} />
    </div>
  );
}
