'use client';

/**
 * MessagesPanel — thin wrapper that renders the timeline feed + SendForm block
 * that appears in the explorer-split right panel.
 *
 * Props mirror the exact props passed to ChatroomMessagesPanel + SendForm in
 * ChatroomDashboard.tsx's explorer-split branch, grouped into a single typed
 * interface so they can be threaded cleanly through RightSplitPanel.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type React from 'react';

import type { FileEntry } from '../components/FileSelector/useFileSelector';
import { MessageInput } from '../components/MessageInput';
import { ChatroomMessagesPanel } from '../components/timeline/ChatroomMessagesPanel';
import type { MessageViewMode } from '../hooks/persistence/useMessageViewMode';
import type { TimelineScrollCoordinator } from '../hooks/timelineScrollCoordinator';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MessagesPanelProps {
  chatroomId: string;
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  machines?: Map<string, { hostname: string; alias?: string }>;
  viewMode: MessageViewMode;
  // SendForm props
  onRegisterSendFormFocus?: (focusFn: () => void) => void;
  onRegisterAllTabNavigation?: (actions: { goToLatestAnchor: () => void }) => void;
  onMessageSent?: () => void;
  autocompleteFiles?: FileEntry[];
  refreshAutocompleteFiles?: () => void;
  hasAutocompleteWorkspace?: boolean;

  workspaceId?: Id<'chatroom_workspaces'> | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MessagesPanel({
  chatroomId,
  coordinator,
  machines,
  viewMode,
  onRegisterSendFormFocus,
  onRegisterAllTabNavigation,
  onMessageSent,
  autocompleteFiles,
  refreshAutocompleteFiles,
  hasAutocompleteWorkspace,
}: MessagesPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ChatroomMessagesPanel
        chatroomId={chatroomId}
        coordinator={coordinator}
        machines={machines}
        viewMode={viewMode}
        onRegisterAllTabNavigation={onRegisterAllTabNavigation}
        footer={
          <div className="shrink-0 border-t-2 border-chatroom-border-strong">
            <MessageInput
              chatroomId={chatroomId}
              onRegisterFocus={onRegisterSendFormFocus}
              onMessageSent={viewMode === 'all' ? onMessageSent : undefined}
              files={autocompleteFiles}
              hasAutocompleteWorkspace={hasAutocompleteWorkspace}
              onAtTriggerActivate={refreshAutocompleteFiles}
            />
          </div>
        }
      />
    </div>
  );
}
