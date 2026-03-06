'use client';

import { memo } from 'react';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { AgentRestartChart } from './AgentRestartChart';

interface AgentRestartStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: string;
  machineId: string;
  workingDir: string;
  chatroomId: string;
}

export const AgentRestartStatsModal = memo(function AgentRestartStatsModal({
  isOpen,
  onClose,
  role,
  machineId,
  workingDir,
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
            <AgentRestartChart
              machineId={machineId}
              workingDir={workingDir}
              chatroomId={chatroomId}
              roles={[role]}
            />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
