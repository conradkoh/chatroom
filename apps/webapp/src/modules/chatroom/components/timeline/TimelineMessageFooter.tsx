'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, Copy, Paperclip } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { MessageDownloadMenu } from './MessageDownloadMenu';
import { useAttachments } from '../../attachments';
import type { Message } from '../../types/message';
import { formatTimestamp } from '../../viewModels/eventStreamViewModel';

/** Small copy-to-clipboard button with brief check-mark feedback. */

const CopyMarkdownButton = memo(function CopyMarkdownButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          copyTimeoutRef.current = null;
        }, 2000);
      });
    },
    [content]
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
      title="Copy as markdown"
    >
      {copied ? <Check size={12} className="text-chatroom-status-success" /> : <Copy size={12} />}
    </button>
  );
});

export interface TimelineMessageFooterProps {
  message: Message;
}

/**
 * Message footer: copy content, attach-as-context, and creation timestamp.
 * Matches pre-revamp MessageFeed footer UX; timestamp always in footer (not header).
 */
export const TimelineMessageFooter = memo(function TimelineMessageFooter({
  message,
}: TimelineMessageFooterProps) {
  const { add: addAttachment, isAttached } = useAttachments();
  const isAddedToContext = isAttached('message', message._id);

  const handleAddToContext = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      addAttachment({
        type: 'message',
        id: message._id as Id<'chatroom_messages'>,
        content: message.content,
        senderRole: message.senderRole,
      });
    },
    [addAttachment, message._id, message.content, message.senderRole]
  );

  return (
    <div
      className="flex justify-between items-center mt-2 pt-1.5"
      data-testid="timeline-message-footer"
    >
      <div className="flex items-center gap-1">
        <CopyMarkdownButton content={message.content} />
        <button
          type="button"
          onClick={handleAddToContext}
          className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          title={isAddedToContext ? 'Added to context' : 'Add to context'}
        >
          <Paperclip size={12} />
        </button>
        <MessageDownloadMenu message={message} />
      </div>
      <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
        {formatTimestamp(message._creationTime)}
      </span>
    </div>
  );
});
