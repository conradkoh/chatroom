'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { MessageSquare } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { messageFeedProseClassNames } from '../../components/markdown-utils';
import { AttachmentChipShell } from '../shared/AttachmentChipShell';
import { getAttachmentChipPreviewLine } from '../shared/attachmentChipUtils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

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
  const [isOpen, setIsOpen] = useState(false);
  const { firstLine, displayText } = getAttachmentChipPreviewLine(props.content);

  return (
    <>
      {/* fallow-ignore-next-line code-duplication */}
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
        onOpen={() => setIsOpen(true)}
        onRemove={props.mode === 'editable' ? props.onRemove : undefined}
      />

      <FixedModal isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setIsOpen(false)}>
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-chatroom-text-muted" />
              <FixedModalTitle>
                Attached Message
                <span className="ml-2 text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wider">
                  from {props.senderRole}
                </span>
              </FixedModalTitle>
            </div>
          </FixedModalHeader>
          <FixedModalBody>
            <div className={`p-4 ${messageFeedProseClassNames}`}>
              <Markdown>{props.content}</Markdown>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
}
