'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Paperclip } from 'lucide-react';
import React from 'react';

import { backlogProseClassNames } from '../../components/markdown-utils';
import { AttachmentChipShell } from '../shared/AttachmentChipShell';
import { AttachmentMarkdownModal } from '../shared/AttachmentMarkdownModal';
import { useAttachmentChipPreview } from '../shared/useAttachmentChipPreview';

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
  const { isOpen, open, close, firstLine, displayText } = useAttachmentChipPreview(props.content);

  return (
    <>
      <AttachmentChipShell
        ariaLabel="View attached task"
        icon={<Paperclip size={12} className="text-chatroom-text-muted flex-shrink-0" />}
        displayText={displayText}
        firstLine={firstLine}
        mode={props.mode}
        onOpen={open}
        onRemove={props.mode === 'editable' ? props.onRemove : undefined}
      />

      <AttachmentMarkdownModal
        isOpen={isOpen}
        onClose={close}
        icon={<Paperclip size={14} className="text-chatroom-text-muted" />}
        title="Attached Task"
        content={props.content}
        proseClassName={backlogProseClassNames}
      />
    </>
  );
}
