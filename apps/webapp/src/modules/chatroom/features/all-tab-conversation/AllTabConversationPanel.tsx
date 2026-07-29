'use client';

import { useMemo } from 'react';

import { ComposerPreflightBar } from '../../components/timeline/ComposerPreflightBar';
import { QueuedMessagesIndicator } from '../../components/QueuedMessagesIndicator';
import type { MachineNameEntry } from '../../components/timeline/timelineRowStyles';
import { useHandoffNotification } from '../../hooks/useHandoffNotification';
import { ChatroomLoader } from '@/components/ui/chatroom-loader';

import { AllTabAnchorNavigator } from './AllTabAnchorNavigator';
import { AllTabMessageList } from './AllTabMessageList';
import { useAllTabConversation } from './hooks/useAllTabConversation';

export function AllTabConversationPanel({
  chatroomId,
  machines,
}: {
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
}) {
  const {
    events,
    messages,
    nav,
    isLoading,
    hasPrev,
    hasNext,
    goToPrev,
    goToNext,
    isOnLatestAnchor,
  } = useAllTabConversation(chatroomId);

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
        contentPreview={nav?.anchor?.contentPreview ?? null}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={goToPrev}
        onNext={goToNext}
      />

      <AllTabMessageList events={events} isOnLatestAnchor={isOnLatestAnchor} machines={machines} />

      <ComposerPreflightBar chatroomId={chatroomId as never} />

      <QueuedMessagesIndicator chatroomId={chatroomId as never} />
    </div>
  );
}
