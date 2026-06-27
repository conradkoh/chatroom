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
import type { TimelineScrollCoordinator } from '../hooks/timelineScrollCoordinator';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MessagesPanelProps {
  chatroomId: string;
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  onRegisterOpenEventStream?: (openFn: () => void) => void;
  machines?: Map<string, { hostname: string; alias?: string }>;
  // SendForm props
  onBeforeResize?: () => void;
  onAfterResize?: () => void;
  onRegisterSendFormFocus?: (focusFn: () => void) => void;
  autocompleteFiles?: FileEntry[];
  refreshAutocompleteFiles?: () => void;

  workspaceId?: Id<'chatroom_workspaces'> | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MessagesPanel({
  chatroomId,
  coordinator,
  onRegisterOpenEventStream,
  machines,
  onBeforeResize,
  onAfterResize,
  onRegisterSendFormFocus,
  autocompleteFiles,
  refreshAutocompleteFiles,
}: MessagesPanelProps) {
  return (
    <ChatroomMessagesPanel
      chatroomId={chatroomId}
      coordinator={coordinator}
      onRegisterOpenEventStream={onRegisterOpenEventStream}
      machines={machines}
      footer={
        <div className="shrink-0 border-t-2 border-chatroom-border-strong">
          <MessageInput
            chatroomId={chatroomId}
            onBeforeResize={onBeforeResize}
            onAfterResize={onAfterResize}
            onRegisterFocus={onRegisterSendFormFocus}
            files={autocompleteFiles}
            onAtTriggerActivate={refreshAutocompleteFiles}
          />
        </div>
      }
    />
  );
}
