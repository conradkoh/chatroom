'use client';

import { ArrowRightLeft } from 'lucide-react';

import { SwitchWorkspaceFlow } from './SwitchWorkspaceFlow';
import { useSwitchWorkspaceFlow } from './useSwitchWorkspaceFlow';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

export interface SwitchWorkspaceDialogProps {
  onClose(): void;
}

/**
 * The `FixedModal` shell around the switch flow. Mounted only while open; the owner restores
 * focus to the picker trigger on close. Backdrop dismissal is disabled: the action is destructive
 * and the user must use Cancel or Done.
 */
// fallow-ignore-next-line complexity
export function SwitchWorkspaceDialog({ onClose }: SwitchWorkspaceDialogProps) {
  const flow = useSwitchWorkspaceFlow();
  const conflict = flow.stale || flow.error?.kind === 'conflict';
  const subtitle = flow.busy
    ? 'Switching…'
    : flow.stage === 'done'
      ? 'Done'
      : flow.stage === 'choose'
        ? 'Step 1 of 2 · Choose a target'
        : conflict
          ? 'Workspace changed'
          : 'Step 2 of 2 · Review and confirm';
  // Escape, backdrop (disabled below) and X are ignored while submitting.
  const requestClose = () => {
    if (!flow.busy) onClose();
  };
  return (
    <FixedModal isOpen onClose={requestClose} maxWidth="max-w-2xl" closeOnBackdrop={false}>
      <FixedModalContent data-testid="switch-workspace-dialog">
        <FixedModalHeader onClose={flow.busy ? undefined : requestClose}>
          <div className="flex items-center gap-3 min-w-0">
            <ArrowRightLeft size={18} className="text-chatroom-status-warning flex-shrink-0" />
            <div className="min-w-0">
              <FixedModalTitle>Switch Workspace</FixedModalTitle>
              <p className="text-xs text-chatroom-text-muted mt-0.5 min-h-[1rem]">{subtitle}</p>
            </div>
          </div>
        </FixedModalHeader>
        <div className="flex shrink-0 items-center border-b-2 border-chatroom-border bg-chatroom-bg-tertiary px-4 py-2 sm:px-6">
          <p className="text-xs text-chatroom-text-secondary">
            Move this chatroom to a different machine or folder.
          </p>
        </div>
        <FixedModalBody className="flex flex-col overflow-hidden">
          <SwitchWorkspaceFlow
            flow={flow}
            doneLabel="Done"
            onCancel={requestClose}
            onDone={() => onClose()}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
