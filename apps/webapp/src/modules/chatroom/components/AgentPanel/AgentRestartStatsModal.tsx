'use client';

import { memo, useState, useEffect } from 'react';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AgentRestartChart } from './AgentRestartChart';

interface AgentRestartStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  roles: string[];
  defaultRole: string;
  machineId: string;
  chatroomId: string;
  /** The active agent's harness/model combo (e.g. "pi/claude-sonnet-4-20250514") for default model selection */
  defaultModel?: string;
}

export const AgentRestartStatsModal = memo(function AgentRestartStatsModal({
  isOpen,
  onClose,
  roles,
  defaultRole,
  machineId,
  chatroomId,
  defaultModel,
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
          <div className="p-4">
            {roles.length > 1 ? (
              <Tabs value={selectedRole} onValueChange={setSelectedRole}>
                <TabsList>
                  {roles.map((role) => (
                    <TabsTrigger key={role} value={role} className="uppercase text-xs">
                      {role}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {roles.map((role) => (
                  <TabsContent key={role} value={role}>
                    <AgentRestartChart
                      machineId={machineId}
                      chatroomId={chatroomId}
                      role={role}
                      defaultModel={role === defaultRole ? defaultModel : undefined}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <AgentRestartChart
                machineId={machineId}
                chatroomId={chatroomId}
                role={selectedRole}
                defaultModel={defaultModel}
              />
            )}
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
