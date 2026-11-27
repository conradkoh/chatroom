'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { memo, useCallback, useState } from 'react';

import { ChatroomActionsMenu } from './ChatroomActionsMenu';
import { ChatroomFavoriteButton } from './ChatroomFavoriteButton';
import { isChatroomShownInTab, type TabType } from './chatroomSelectorModel';
import { ChatroomStatusIndicator } from './ChatroomStatusIndicator';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';
import { useChatroomStatus } from '../../hooks/useChatroomStatus';
import { getChatroomDisplayName } from '../../viewModels/chatroomViewModel';
import { createChatroomSelectKeyDown } from '../chatroom-select-keydown';
import { LifecycleConfirmDialog } from '../LifecycleConfirmDialog';

import { ExportFeedback } from '@/modules/chatroom/features/transfer/components/ExportFeedback';
import { useChatroomExportAction } from '@/modules/chatroom/features/transfer/hooks/useChatroomExportAction';

export interface ChatroomCardProps {
  chatroom: ChatroomWithStatus;
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}

/** Live activity and state for one chatroom. Both are undefined until the status arrives. */
function useCardStatus(chatroomId: string) {
  const { status } = useChatroomStatus(chatroomId);
  return { activityStatus: status?.activityStatus, state: status?.state };
}

/** One chatroom in the grid. Renders nothing when the chatroom belongs to the other tab. */
// fallow-ignore-next-line complexity
export const ChatroomCard = memo(function ChatroomCard({
  chatroom,
  onSelect,
  activeTab,
}: ChatroomCardProps) {
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const toggleFavorite = useSessionMutation(api.chatrooms.toggleFavorite);
  const { activityStatus, state } = useCardStatus(chatroom._id);
  const exportAction = useChatroomExportAction(chatroom._id, chatroom.name ?? null);
  const { start: startExport } = exportAction;

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      try {
        await toggleFavorite({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
      }
    },
    [toggleFavorite, chatroom._id]
  );

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    setArchiveDialogOpen(true);
  }, []);

  const handleExport = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      startExport();
    },
    [startExport]
  );

  if (!isChatroomShownInTab(chatroom, state, activeTab)) {
    return null;
  }

  return (
    <>
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          className="bg-chatroom-bg-surface border-2 border-chatroom-border p-2 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer w-full"
          onClick={() => onSelect(chatroom._id)}
          onKeyDown={createChatroomSelectKeyDown(() => onSelect(chatroom._id))}
          data-chat-status={activityStatus ?? 'loading'}
        >
          {/* Card Main */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
              <ChatroomStatusIndicator activityStatus={activityStatus} />
              <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary truncate">
                {getChatroomDisplayName(chatroom)}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ChatroomFavoriteButton
                isFavorite={chatroom.isFavorite}
                onClick={handleToggleFavorite}
              />
              <ChatroomActionsMenu
                canArchive={state !== 'completed'}
                exporting={exportAction.exporting}
                triggerHoverClassName="hover:bg-chatroom-bg-hover"
                onExport={handleExport}
                onArchive={handleArchive}
              />
            </div>
          </div>
        </div>
      </div>

      <ExportFeedback
        exporting={exportAction.exporting}
        label={exportAction.label}
        feedback={exportAction.feedback}
        onDismiss={exportAction.dismiss}
        onRetry={exportAction.retryable ? exportAction.start : undefined}
        className="mt-1"
        data-testid="chatroom-export-feedback"
      />

      <LifecycleConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        chatroomId={chatroom._id as Id<'chatroom_rooms'>}
        action="archive"
      />
    </>
  );
});
