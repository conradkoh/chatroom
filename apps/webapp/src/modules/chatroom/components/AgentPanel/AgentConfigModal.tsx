'use client';

import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import { memo } from 'react';

import { WorkspaceInlineAgentListPanel } from './WorkspaceInlineAgentListPanel';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

export interface AgentConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  /** Sticky: the dashboard keeps the last role while the close animation runs. */
  role: string;
  /** Closes this modal, then opens Settings → Agents. */
  onViewAllAgents: () => void;
}

/** Single-agent config modal — reuses the workspace list panel in single-role mode
 *  so the modal and the Settings Agents tab share one controls wiring path. */
export const AgentConfigModal = memo(function AgentConfigModal({
  isOpen,
  onClose,
  chatroomId,
  role,
  onViewAllAgents,
}: AgentConfigModalProps) {
  const ephemeral = isEphemeralAgentRole(role);
  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent data-testid="agent-config-modal">
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-2 min-w-0 w-full pr-2">
            <FixedModalTitle className="flex items-center gap-2 min-w-0">
              <span className="flex-shrink-0">Configure Agent</span>
              <span className="text-chatroom-text-muted flex-shrink-0" aria-hidden>
                /
              </span>
              <span className="truncate" data-testid="agent-config-modal-role">
                {role}
              </span>
            </FixedModalTitle>
            <span
              data-testid="agent-config-modal-lifecycle"
              className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-chatroom-border text-chatroom-text-muted bg-chatroom-bg-tertiary"
            >
              {ephemeral ? 'Ephemeral' : 'Permanent'}
            </span>
            <button
              type="button"
              onClick={onViewAllAgents}
              data-testid="agent-config-modal-view-all"
              className="ml-auto flex-shrink-0 text-[10px] font-bold uppercase tracking-widest text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
            >
              All agents<span className="hidden sm:inline"> →</span>
            </button>
          </div>
        </FixedModalHeader>
        <FixedModalBody>
          <WorkspaceInlineAgentListPanel
            chatroomId={chatroomId}
            role={role}
            variant="plain"
            onViewAllAgents={onViewAllAgents}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
