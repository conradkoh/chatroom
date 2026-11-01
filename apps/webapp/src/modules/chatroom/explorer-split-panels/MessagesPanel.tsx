'use client';

/**
 * MessagesPanel — thin wrapper that renders the timeline feed + SendForm block
 * that appears in the explorer-split right panel.
 *
 * Props mirror the exact props passed to ChatroomMessagesPanel + SendForm in
 * ChatroomDashboard.tsx's explorer-split branch, grouped into a single typed
 * interface so they can be threaded cleanly through RightSplitPanel.
 */

import type React from 'react';

import type { FileEntry } from '../components/FileSelector/useFileSelector';
import { MessageInput } from '../components/MessageInput';
import { ChatroomMessagesPanel } from '../components/timeline/ChatroomMessagesPanel';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MessagesPanelProps {
  chatroomId: string;
  // SendForm props
  onRegisterSendFormFocus?: (focusFn: () => void) => void;
  onRegisterConversationNavigation?: (actions: { goToLatestAnchor: () => void }) => void;
  onRequestComposerFocus?: () => void;
  onMessageSent?: () => void;
  autocompleteFiles?: FileEntry[];
  refreshAutocompleteFiles?: () => void;
  hasAutocompleteWorkspace?: boolean;
  machineId?: string | null;
  workingDir?: string | null;
  onUploadComplete?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MessagesPanel({
  chatroomId,
  onRegisterSendFormFocus,
  onRegisterConversationNavigation,
  onRequestComposerFocus,
  onMessageSent,
  autocompleteFiles,
  refreshAutocompleteFiles,
  hasAutocompleteWorkspace,
  machineId = null,
  workingDir = null,
  onUploadComplete,
}: MessagesPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ChatroomMessagesPanel
        chatroomId={chatroomId}
        onRegisterConversationNavigation={onRegisterConversationNavigation}
        onRequestComposerFocus={onRequestComposerFocus}
        footer={
          <div className="shrink-0 border-t-2 border-chatroom-border-strong">
            <MessageInput
              key={chatroomId}
              chatroomId={chatroomId}
              onRegisterFocus={onRegisterSendFormFocus}
              onMessageSent={onMessageSent}
              files={autocompleteFiles}
              hasAutocompleteWorkspace={hasAutocompleteWorkspace}
              onAtTriggerActivate={refreshAutocompleteFiles}
              machineId={machineId}
              workingDir={workingDir}
              onUploadComplete={onUploadComplete}
            />
          </div>
        }
      />
    </div>
  );
}
