'use client';

import { memo, useState, useEffect } from 'react';

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
  roles: string[];
  defaultRole: string;
  machineId: string;
  chatroomId: string;
}

const TAB_BASE = 'text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 transition-colors';
const TAB_ACTIVE = 'border-b-2 border-chatroom-accent text-chatroom-text-primary';
const TAB_INACTIVE =
  'border-b-2 border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary';

export const AgentRestartStatsModal = memo(function AgentRestartStatsModal({
  isOpen,
  onClose,
  roles,
  defaultRole,
  machineId,
  chatroomId,
}: AgentRestartStatsModalProps) {
  const [selectedRole, setSelectedRole] = useState(defaultRole);

  // Sync selectedRole when defaultRole changes (e.g., different agent's "View Stats" clicked)
  useEffect(() => {
    if (isOpen) {
      setSelectedRole(defaultRole);
    }
  }, [isOpen, defaultRole]);

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>Agent Restart Metrics</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody>
          <div className="p-4 space-y-3">
            {/* Role tabs */}
            {roles.length > 1 && (
              <div className="flex items-center gap-1 border-b border-chatroom-border">
                {roles.map((role) => (
                  <button
                    key={role}
                    onClick={() => setSelectedRole(role)}
                    className={`${TAB_BASE} ${selectedRole === role ? TAB_ACTIVE : TAB_INACTIVE}`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            )}
            <AgentRestartChart
              machineId={machineId}
              chatroomId={chatroomId}
              role={selectedRole}
            />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
