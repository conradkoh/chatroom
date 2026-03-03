'use client';

import { memo } from 'react';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

import { CopyButton } from '../CopyButton';

interface PromptViewerModalProps {
  open: boolean;
  onClose: () => void;
  role: string;
  prompt: string;
}

export function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Modal displaying the full agent prompt with a copy button. */
export const PromptViewerModal = memo(function PromptViewerModal({
  open,
  onClose,
  role,
  prompt,
}: PromptViewerModalProps) {
  return (
    <FixedModal isOpen={open} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose} className="bg-chatroom-bg-primary">
          <div className="flex items-center justify-between w-full pr-2">
            <FixedModalTitle>{toTitleCase(role)} Prompt</FixedModalTitle>
            <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
          </div>
        </FixedModalHeader>
        <FixedModalBody className="bg-chatroom-bg-primary">
          <div className="p-4">
            <pre className="text-[11px] font-mono text-chatroom-text-secondary whitespace-pre-wrap break-words leading-relaxed">
              {prompt}
            </pre>
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
