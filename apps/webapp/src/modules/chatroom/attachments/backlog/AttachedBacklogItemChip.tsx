'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ListChecks } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { getScoringBadge } from '../../components/backlog';
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

type AttachedBacklogItemChipCommon = {
  itemId: Id<'chatroom_backlog'>;
  content: string;
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
  priority?: number;
};

type AttachedBacklogItemChipProps =
  | (AttachedBacklogItemChipCommon & { mode: 'editable'; onRemove: () => void })
  | (AttachedBacklogItemChipCommon & { mode: 'view' });

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
  const [isOpen, setIsOpen] = useState(false);
  const { firstLine, displayText } = getAttachmentChipPreviewLine(props.content);

  return (
    <>
      {/* fallow-ignore-next-line code-duplication */}
      <AttachmentChipShell
        ariaLabel="View attached backlog item"
        icon={<ListChecks size={12} className="text-chatroom-text-muted flex-shrink-0" />}
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
              <ListChecks size={14} className="text-chatroom-text-muted" />
              <FixedModalTitle>Backlog Item</FixedModalTitle>
              {/* Scoring Badges */}
              {props.priority !== undefined && (
                <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
                  P:{props.priority}
                </span>
              )}
              {props.complexity && (
                <span
                  className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', props.complexity).classes}`}
                >
                  {getScoringBadge('complexity', props.complexity).label}
                </span>
              )}
              {props.value && (
                <span
                  className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', props.value).classes}`}
                >
                  {getScoringBadge('value', props.value).label}
                </span>
              )}
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
