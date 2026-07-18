'use client';

import { Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import Markdown from 'react-markdown';

import type { Message } from '../../types/message';
import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import { backlogReviewCompactMarkdownComponents } from '../markdown-utils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

interface TimelineContextMessageProps {
  message: Message;
}

/**
 * Context boundary row — horizontal-line divider (non-sticky, visual only).
 */
export const TimelineContextMessage = memo(function TimelineContextMessage({
  message,
}: TimelineContextMessageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const createdByLabel = message.contextCreatedBy
    ? message.contextCreatedBy.charAt(0).toUpperCase() + message.contextCreatedBy.slice(1)
    : null;

  return (
    <div
      className="bg-chatroom-bg-primary border-b-2 border-chatroom-border px-4 py-3"
      data-testid="timeline-context"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div
          className="hidden md:block flex-1 h-px bg-chatroom-status-info/30"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full md:min-w-0 flex flex-col items-start gap-1.5 md:flex-row md:items-center md:gap-2 px-3 py-2 md:py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info bg-chatroom-status-info/10 border border-chatroom-status-info/30 overflow-hidden cursor-pointer hover:bg-chatroom-status-info/15 transition-colors text-left"
        >
          <span className="flex items-center gap-2 shrink-0">
            <Sparkles size={10} className="shrink-0" />
            <span className="shrink-0">New Context</span>
            {createdByLabel && (
              <>
                <span className="text-chatroom-status-info/50 shrink-0">·</span>
                <span className="shrink-0 text-chatroom-status-info/80">{createdByLabel}</span>
              </>
            )}
          </span>

          <span
            className="hidden md:inline text-chatroom-status-info/50 shrink-0"
            aria-hidden="true"
          >
            —
          </span>

          <span className="w-full md:flex-1 md:min-w-0 normal-case font-medium tracking-normal line-clamp-2 md:line-clamp-none md:truncate text-chatroom-text-secondary [&_*]:inline">
            <Markdown
              remarkPlugins={chatroomRemarkPlugins}
              components={backlogReviewCompactMarkdownComponents}
            >
              {message.content}
            </Markdown>
          </span>
        </button>
        <div
          className="hidden md:block flex-1 h-px bg-chatroom-status-info/30"
          aria-hidden="true"
        />
      </div>

      <FixedModal isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setIsOpen(false)}>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-chatroom-status-info" />
              <FixedModalTitle>
                Context{createdByLabel ? ` — ${createdByLabel}` : ''}
              </FixedModalTitle>
            </div>
          </FixedModalHeader>
          <FixedModalBody>
            <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
              <Markdown remarkPlugins={chatroomRemarkPlugins}>{message.content}</Markdown>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </div>
  );
});
