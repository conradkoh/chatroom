'use client';

import type { ReactNode } from 'react';
import Markdown from 'react-markdown';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

type AttachmentMarkdownModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  content: string;
  proseClassName: string;
};

/** Shared markdown preview modal for task/backlog/message attachment chips. */
export function AttachmentMarkdownModal({
  isOpen,
  onClose,
  title,
  icon,
  content,
  proseClassName,
}: AttachmentMarkdownModalProps) {
  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-2">
            {icon}
            <FixedModalTitle>{title}</FixedModalTitle>
          </div>
        </FixedModalHeader>
        <FixedModalBody>
          <div className={`p-4 ${proseClassName}`}>
            <Markdown>{content}</Markdown>
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
