'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Paperclip } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { backlogProseClassNames } from '../../components/markdown-utils';
import { AttachmentChipShell } from '../shared/AttachmentChipShell';
import { getAttachmentChipPreviewLine } from '../shared/attachmentChipUtils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

type AttachedTaskChipProps =
  | { mode: 'editable'; taskId: Id<'chatroom_tasks'>; content: string; onRemove: () => void }
  | { mode: 'view'; taskId: Id<'chatroom_tasks'>; content: string };

/**
 * Displays a single attached task as a chip.
 *
 * Supports two modes via a discriminated union on `mode`:
 * - `'view'` — read-only chip. Clicking the label opens a full preview modal.
 * - `'editable'` — includes an X remove button. `onRemove` is required.
 *
 * Renders minimal markdown in the chip; full markdown in the modal.
 */
export function AttachedTaskChip(props: AttachedTaskChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { firstLine, displayText } = getAttachmentChipPreviewLine(props.content);

  return (
    <>
      {/* fallow-ignore-next-line code-duplication */}
      <AttachmentChipShell
        ariaLabel="View attached task"
        icon={<Paperclip size={12} className="text-chatroom-text-muted flex-shrink-0" />}
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
              <Paperclip size={14} className="text-chatroom-text-muted" />
              <FixedModalTitle>Attached Task</FixedModalTitle>
            </div>
          </FixedModalHeader>
          <FixedModalBody>
            <div className={`p-4 ${backlogProseClassNames}`}>
              <Markdown>{props.content}</Markdown>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
}
