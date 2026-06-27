'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { MessageSquare } from 'lucide-react';
import React from 'react';

import { messageFeedProseClassNames } from '../../components/markdown-utils';
import { AttachmentChipShell } from '../shared/AttachmentChipShell';
import { AttachmentMarkdownModal } from '../shared/AttachmentMarkdownModal';
import { useAttachmentChipPreview } from '../shared/useAttachmentChipPreview';

type AttachedMessageChipProps =
  | {
      mode: 'editable';
      messageId: Id<'chatroom_messages'>;
      content: string;
      senderRole: string;
      onRemove: () => void;
    }
  | { mode: 'view'; messageId: Id<'chatroom_messages'>; content: string; senderRole: string };

/**
 * Displays a single attached message as a chip.
 *
 * Supports two modes via a discriminated union on `mode`:
 * - `'view'` — read-only chip. Clicking the label opens a full preview modal.
 * - `'editable'` — includes an X remove button. `onRemove` is required.
 */
export function AttachedMessageChip(props: AttachedMessageChipProps) {
  const { isOpen, open, close, firstLine, displayText } = useAttachmentChipPreview(props.content);

  return (
    <>
      <AttachmentChipShell
        ariaLabel="View attached message"
        icon={<MessageSquare size={12} className="text-chatroom-text-muted flex-shrink-0" />}
        prefix={
          <span className="text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
            {props.senderRole}:
          </span>
        }
        displayText={displayText}
        firstLine={firstLine}
        mode={props.mode}
        onOpen={open}
        onRemove={props.mode === 'editable' ? props.onRemove : undefined}
      />

      <AttachmentMarkdownModal
        isOpen={isOpen}
        onClose={close}
        icon={<MessageSquare size={14} className="text-chatroom-text-muted" />}
        title={
          <>
            Attached Message
            <span className="ml-2 text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wider">
              from {props.senderRole}
            </span>
          </>
        }
        content={props.content}
        proseClassName={messageFeedProseClassNames}
      />
    </>
  );
}
