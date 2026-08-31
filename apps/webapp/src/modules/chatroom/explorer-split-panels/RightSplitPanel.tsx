'use client';

/** RightSplitPanel — the messages side of the explorer-split view. */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { MessagesPanel, type MessagesPanelProps } from './MessagesPanel';

// ─── Props ────────────────────────────────────────────────────────────────────

// Props forwarded to MessagesPanel (all except chatroomId)
type MessagesPanelOwnProps = Omit<MessagesPanelProps, 'chatroomId'>;

export interface RightSplitPanelProps {
  chatroomId: Id<'chatroom_rooms'>;
  messagesPanelProps: MessagesPanelOwnProps;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RightSplitPanel({ chatroomId, messagesPanelProps }: RightSplitPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" data-testid="right-split-panel">
      <MessagesPanel chatroomId={chatroomId as string} {...messagesPanelProps} />
    </div>
  );
}
