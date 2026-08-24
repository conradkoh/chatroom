'use client';

import { memo } from 'react';

import { InlineAgentListPanel } from './InlineAgentListPanel';
import { useInlineAgentList } from './useInlineAgentList';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

interface UnifiedAgentListModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
}

/** All Agents modal — flat role-based agent list.
 *  Self-sufficient: fetches agents and prompt data internally.
 *  Works correctly when rendered outside PromptsProvider (prompt defaults to ''). */
export const UnifiedAgentListModal = memo(function UnifiedAgentListModal({
  isOpen,
  onClose,
  chatroomId,
}: UnifiedAgentListModalProps) {
  const { totalCount } = useInlineAgentList(chatroomId);

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>All Agents ({totalCount})</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody className="flex flex-col p-0 overflow-hidden">
          {/* Agent list — scrollable */}
          <div className="flex-1 overflow-y-auto">
            <InlineAgentListPanel chatroomId={chatroomId} variant="plain" />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
