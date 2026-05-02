'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { MessageSquare, X } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { compactMarkdownComponents, messageFeedProseClassNames } from './markdown-utils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';


interface AttachedMessageChipProps {
  messageId: Id<'chatroom_messages'>;
  content: string;
  senderRole: string;
  onRemove: () => void;
}

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
 * Displays a single attached message as a removable chip.
 * Click the chip label to open a centered modal showing the full content.
 */
export function AttachedMessageChip({ content, senderRole, onRemove }: AttachedMessageChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get first non-empty line for chip label, stripping markdown heading syntax
  const rawFirstLine = content.split('\n').find((line) => line.trim()) || content;
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
          aria-label="View attached message"
        >
          <MessageSquare size={12} className="text-chatroom-text-muted flex-shrink-0" />
          <span className="text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
            {senderRole}:
          </span>
          <span
            className="text-chatroom-text-secondary truncate max-w-[150px] hover:text-chatroom-text-primary transition-colors text-[10px] font-bold uppercase tracking-wider"
            title={firstLine}
          >
            <Markdown components={compactMarkdownComponents}>{displayText}</Markdown>
          </span>
        </button>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors flex-shrink-0"
          aria-label="Remove attachment"
          type="button"
        >
          <X size={12} />
        </button>
      </div>

      <FixedModal isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setIsOpen(false)}>
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-chatroom-text-muted" />
              <FixedModalTitle>
                Attached Message
                <span className="ml-2 text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wider">
                  from {senderRole}
                </span>
              </FixedModalTitle>
            </div>
          </FixedModalHeader>
          <FixedModalBody>
            <div className={`p-4 ${messageFeedProseClassNames}`}>
              <Markdown>{content}</Markdown>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
}
