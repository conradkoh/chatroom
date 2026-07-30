'use client';

import { useEffect, useRef } from 'react';
import type React from 'react';

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';
import type { MachineNameEntry } from './timelineRowStyles';
import {
  AllTabConversationPanel,
  type AllTabNavigationActions,
} from '../../features/all-tab-conversation/AllTabConversationPanel';
import {
  isFilteredMessageViewMode,
  messageViewModeToSenderRole,
  type MessageViewMode,
} from '../../hooks/persistence/messageViewMode';
import type { TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';

export interface ChatroomMessagesPanelProps {
  chatroomId: string;
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  onRegisterOpenEventStream?: (openFn: () => void) => void;
  onRegisterMessageStoreActions?: (actions: {
    removeMessagesForTask: (taskId: string) => void;
  }) => void;
  machines?: Map<string, MachineNameEntry>;
  viewMode: MessageViewMode;
  onRegisterAllTabNavigation?: (actions: AllTabNavigationActions) => void;
  /** Optional footer (MessageInput) rendered below feed */
  footer?: React.ReactNode;
}

export function ChatroomMessagesPanel({
  chatroomId,
  coordinator,
  onRegisterOpenEventStream,
  onRegisterMessageStoreActions,
  machines,
  viewMode,
  onRegisterAllTabNavigation,
  footer,
}: ChatroomMessagesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      coordinator.current.notifyContainerResize();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [coordinator]);

  const filterRole = isFilteredMessageViewMode(viewMode)
    ? messageViewModeToSenderRole(viewMode)
    : null;

  return (
    <div ref={panelRef} className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      {viewMode === 'all' ? (
        <AllTabConversationPanel
          chatroomId={chatroomId}
          machines={machines}
          onRegisterAllTabNavigation={onRegisterAllTabNavigation}
        />
      ) : (
        <ChatroomTimelineFeed
          key={filterRole ?? 'all'}
          chatroomId={chatroomId}
          coordinator={coordinator}
          onRegisterOpenEventStream={onRegisterOpenEventStream}
          onRegisterMessageStoreActions={onRegisterMessageStoreActions}
          machines={machines}
          senderRoleFilter={filterRole}
        />
      )}

      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );
}
