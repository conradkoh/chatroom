'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ListChecks, X } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { getScoringBadge } from './backlog';
import { compactMarkdownComponents, backlogProseClassNames } from './markdown-utils';

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
 * Truncate text to a maximum length with ellipsis.
 */
function truncateText(text: string, maxLength = 30): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

/**
 * Strip leading markdown heading syntax (# characters) from a line.
 * e.g. "## My Task" → "My Task"
 */
function stripMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, '');
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
export function AttachedBacklogItemChip(props: AttachedBacklogItemChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const rawFirstLine = props.content.split('\n').find((line) => line.trim()) || props.content;
  const firstLine = stripMarkdownHeading(rawFirstLine);
  const displayText = truncateText(firstLine);

  return (
    <>
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs group hover:border-chatroom-border-strong transition-colors">
        {/* Clickable label */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 cursor-pointer focus:outline-none"
          aria-label="View attached backlog item"
        >
          <ListChecks size={12} className="text-chatroom-text-muted flex-shrink-0" />
          <span
            className="text-chatroom-text-secondary truncate max-w-[150px] hover:text-chatroom-text-primary transition-colors text-[10px] font-bold uppercase tracking-wider"
            title={firstLine}
          >
            <Markdown components={compactMarkdownComponents}>{displayText}</Markdown>
          </span>
        </button>

        {/* Remove button — only in editable mode */}
        {props.mode === 'editable' && (
          <button
            onClick={props.onRemove}
            className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors flex-shrink-0"
            aria-label="Remove attachment"
            type="button"
          >
            <X size={12} />
          </button>
        )}
      </div>

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
