'use client';

// fallow-ignore-file code-duplication

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ListChecks } from 'lucide-react';
import React, { useCallback } from 'react';

import { getScoringBadge } from '../../components/backlog';
import { backlogProseClassNames } from '../../components/markdown-utils';
import { useAttachments } from '../context/AttachmentsContext';
import { AttachmentChipShell } from '../shared/AttachmentChipShell';
import { AttachmentMarkdownModal } from '../shared/AttachmentMarkdownModal';
import { useAttachmentChipPreview } from '../shared/useAttachmentChipPreview';

import { reserializeMarkdownBlankLines } from '@/components/markdown-editor/utils/reserializeMarkdownBlankLines';

type AttachedBacklogItemChipCommon = {
  itemId: Id<'chatroom_backlog'>;
  content: string;
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
  priority?: number;
};

type AttachedBacklogItemChipProps =
  | (AttachedBacklogItemChipCommon & {
      mode: 'editable';
      chatroomId: Id<'chatroom_rooms'>;
      onRemove: () => void;
    })
  | (AttachedBacklogItemChipCommon & { mode: 'view' });

function BacklogItemModalTitle({
  priority,
  complexity,
  value,
}: Pick<AttachedBacklogItemChipCommon, 'priority' | 'complexity' | 'value'>) {
  return (
    <div className="flex items-center gap-2">
      <span>Backlog Item</span>
      {priority !== undefined && (
        <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
          P:{priority}
        </span>
      )}
      {complexity && (
        <span
          className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', complexity).classes}`}
        >
          {getScoringBadge('complexity', complexity).label}
        </span>
      )}
      {value && (
        <span
          className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', value).classes}`}
        >
          {getScoringBadge('value', value).label}
        </span>
      )}
    </div>
  );
}

type EditableBacklogAttachmentModalProps = AttachedBacklogItemChipCommon & {
  chatroomId: Id<'chatroom_rooms'>;
  isOpen: boolean;
  onClose: () => void;
};

/** Editable modal isolated so view-mode chips do not require AttachmentsProvider. */
function EditableBacklogAttachmentModal({
  chatroomId,
  itemId,
  content,
  isOpen,
  onClose,
  priority,
  complexity,
  value,
}: EditableBacklogAttachmentModalProps) {
  const updateItem = useSessionMutation(api.backlog.updateBacklogItem);
  const { updateContent } = useAttachments();

  const handleSave = useCallback(
    async (newContent: string) => {
      const serialized = reserializeMarkdownBlankLines(newContent);
      await updateItem({
        chatroomId,
        itemId,
        content: serialized,
      });
      updateContent('backlog', itemId, serialized);
    },
    [chatroomId, itemId, updateItem, updateContent]
  );

  return (
    <AttachmentMarkdownModal
      isOpen={isOpen}
      onClose={onClose}
      icon={<ListChecks size={14} className="text-chatroom-text-muted" />}
      title={<BacklogItemModalTitle priority={priority} complexity={complexity} value={value} />}
      content={content}
      proseClassName={backlogProseClassNames}
      editable
      onSave={handleSave}
    />
  );
}

/**
 * Displays a single attached backlog item as a chip.
 *
 * Supports two modes via a discriminated union on `mode`:
 * - `'view'` — read-only chip. Clicking the label opens a full preview modal.
 * - `'editable'` — includes an X remove button. `onRemove` is required.
 *
 * Renders minimal markdown in the chip; full markdown in the modal.
 */
// fallow-ignore-next-line complexity
export function AttachedBacklogItemChip(props: AttachedBacklogItemChipProps) {
  const { isOpen, open, close, firstLine, displayText } = useAttachmentChipPreview(props.content);

  return (
    <>
      <AttachmentChipShell
        ariaLabel="View attached backlog item"
        icon={<ListChecks size={12} className="text-chatroom-text-muted flex-shrink-0" />}
        displayText={displayText}
        firstLine={firstLine}
        mode={props.mode}
        onOpen={open}
        onRemove={props.mode === 'editable' ? props.onRemove : undefined}
      />

      {props.mode === 'editable' ? (
        <EditableBacklogAttachmentModal
          chatroomId={props.chatroomId}
          itemId={props.itemId}
          content={props.content}
          priority={props.priority}
          complexity={props.complexity}
          value={props.value}
          isOpen={isOpen}
          onClose={close}
        />
      ) : (
        <AttachmentMarkdownModal
          isOpen={isOpen}
          onClose={close}
          icon={<ListChecks size={14} className="text-chatroom-text-muted" />}
          title={
            <BacklogItemModalTitle
              priority={props.priority}
              complexity={props.complexity}
              value={props.value}
            />
          }
          content={props.content}
          proseClassName={backlogProseClassNames}
        />
      )}
    </>
  );
}
