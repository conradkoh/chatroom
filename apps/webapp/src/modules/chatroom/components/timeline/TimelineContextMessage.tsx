'use client';

import { Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import Markdown from 'react-markdown';

import type { Message } from '../../types/message';
import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import { compactMarkdownComponents } from '../markdown-utils';

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

  return (
    <div
      className="bg-chatroom-bg-primary border-b-2 border-chatroom-border px-4 py-3"
      data-testid="timeline-context"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-chatroom-status-info/30" />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info bg-chatroom-status-info/10 border border-chatroom-status-info/30 min-w-0 overflow-hidden cursor-pointer hover:bg-chatroom-status-info/15 transition-colors"
        >
          <Sparkles size={10} className="flex-shrink-0" />
          <span className="flex-shrink-0">New Context</span>
          <span className="text-chatroom-status-info/50 flex-shrink-0">—</span>
          <span className="normal-case font-medium tracking-normal flex-1 min-w-0 truncate text-chatroom-text-secondary [&_*]:inline text-left">
            <Markdown remarkPlugins={chatroomRemarkPlugins} components={compactMarkdownComponents}>
              {message.content}
            </Markdown>
          </span>
        </button>
        <div className="flex-1 h-px bg-chatroom-status-info/30" />
      </div>

      <FixedModal isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setIsOpen(false)}>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-chatroom-status-info" />
              <FixedModalTitle>Context</FixedModalTitle>
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
