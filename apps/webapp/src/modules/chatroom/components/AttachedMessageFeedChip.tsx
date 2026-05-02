'use client';

import { MessageSquare } from 'lucide-react';
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


interface AttachedMessageFeedChipProps {
  /** Full message content */
  content: string;
  /** Role of the message sender (e.g. "user", "builder", "planner") */
  senderRole: string;
  /** Badge base class name from MessageFeed */
  badgeBase: string;
  /** Icon size from MessageFeed */
  iconSize: number;
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
 * Displays a single attached message as a clickable chip in the message feed.
 * Shows a truncated content snippet with sender role prefix.
 * Click to open a modal showing the full message content.
 */
export function AttachedMessageFeedChip({
  content,
  senderRole,
  badgeBase,
  iconSize,
}: AttachedMessageFeedChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get first non-empty line for chip label, stripping markdown heading syntax
  const rawFirstLine = content.split('\n').find((line) => line.trim()) || content;
  const firstLine = stripMarkdownHeading(rawFirstLine);
  const displayText = truncateText(firstLine);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`${badgeBase} bg-chatroom-bg-tertiary text-chatroom-text-muted border border-chatroom-border cursor-pointer hover:border-chatroom-border-strong hover:text-chatroom-text-secondary transition-colors`}
        aria-label={`View attached message from ${senderRole}`}
        title={firstLine}
      >
        <MessageSquare size={iconSize} className="flex-shrink-0" />
        <span className="flex-shrink-0">{senderRole}:</span>
        <span className="truncate max-w-[120px]">{displayText}</span>
      </button>

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
              <Markdown components={compactMarkdownComponents}>{content}</Markdown>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
}
