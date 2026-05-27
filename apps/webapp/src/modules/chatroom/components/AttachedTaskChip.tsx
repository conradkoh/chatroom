'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Paperclip, X } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { compactMarkdownComponents, backlogProseClassNames } from './markdown-utils';

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
          aria-label="View attached task"
        >
          <Paperclip size={12} className="text-chatroom-text-muted flex-shrink-0" />
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
