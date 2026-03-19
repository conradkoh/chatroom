'use client';

import { memo } from 'react';

import { AgentRestartChart } from './AgentRestartChart';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

interface AgentRestartStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: string;
  machineId: string;
  chatroomId: string;
}

export const AgentRestartStatsModal = memo(function AgentRestartStatsModal({
  isOpen,
  onClose,
  role,
  machineId,
  chatroomId,
}: AgentRestartStatsModalProps) {
  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>{role.toUpperCase()} — Restart Metrics</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody>
          <div className="p-4">
            <AgentRestartChart machineId={machineId} chatroomId={chatroomId} roles={[role]} />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
