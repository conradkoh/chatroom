'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { messageFromError } from './lib/errorMessage';
import { NewChatroomAgentsStep } from './NewChatroomAgentsStep';
import { NewChatroomMachineStep } from './NewChatroomMachineStep';
import { NewChatroomWorkspaceStep } from './NewChatroomWorkspaceStep';
import { TEAMS_CONFIG } from '../../config/teams';
import type { UserMachine } from '../../types/machine';

import { useDaemonConnectivity } from '@/hooks/useDaemonConnectivity';
import { useUserMachines } from '@/hooks/useUserMachines';

export interface NewChatroomWizardProps {
  onCreated: (chatroomId: string) => void;
  onCancel: () => void;
}

type WizardStep = 'machine' | 'workspace' | 'agents';

const STEP_NUMBER: Record<WizardStep, number> = { machine: 1, workspace: 2, agents: 3 };
const STEP_LABEL: Record<WizardStep, string> = {
  machine: 'Machine',
  workspace: 'Workspace',
  agents: 'Agents',
};

interface CreatedChatroom {
  chatroomId: string;
  machineId: string;
  workingDir: string;
}

/** Step 2 view. Nothing is shown until the machine is known. */
function WorkspaceStepView({
  machine,
  connectedMachineIds,
  isCreating,
  createError,
  onBack,
  onCancel,
  onWorkspaceReady,
}: {
  machine: UserMachine | null;
  connectedMachineIds: ReadonlySet<string>;
  isCreating: boolean;
  createError: string | null;
  onBack: () => void;
  onCancel: () => void;
  onWorkspaceReady: (workingDir: string) => void;
}) {
  if (!machine) return null;
  return (
    <NewChatroomWorkspaceStep
      machine={machine}
      isMachineConnected={connectedMachineIds.has(machine.machineId)}
      isCreating={isCreating}
      createError={createError}
      onBack={onBack}
      onCancel={onCancel}
      onWorkspaceReady={onWorkspaceReady}
    />
  );
}

/** Step 3 view. Nothing is shown until the chatroom exists. */
function AgentsStepView({
  created,
  connectedMachines,
  onCreated,
}: {
  created: CreatedChatroom | null;
  connectedMachines: UserMachine[];
  onCreated: (chatroomId: string) => void;
}) {
  if (!created) return null;
  return (
    <NewChatroomAgentsStep
      chatroomId={created.chatroomId}
      machineId={created.machineId}
      workingDir={created.workingDir}
      connectedMachines={connectedMachines}
      onDone={() => onCreated(created.chatroomId)}
    />
  );
}

/**
 * New chatroom wizard: machine → workspace → agents. The chatroom is created in one call
 * (`createWithWorkspace`) only after a folder is chosen, never before.
 */
export function NewChatroomWizard({ onCreated, onCancel }: NewChatroomWizardProps) {
  const [step, setStep] = useState<WizardStep>('machine');
  const [chosenMachineId, setChosenMachineId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedChatroom | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Synchronous guard: a second click before React re-renders must not create a second chatroom.
  const creatingRef = useRef(false);

  const createWithWorkspace = useSessionMutation(api.chatrooms.createWithWorkspace);
  const { machines, isLoading } = useUserMachines();
  const connectivity = useDaemonConnectivity();

  const connectedMachineIds = useMemo(
    () =>
      new Set(
        machines
          .filter((machine) => connectivity.get(machine.machineId)?.connected === true)
          .map((machine) => machine.machineId)
      ),
    [machines, connectivity]
  );
  const connectedMachines = useMemo(
    () => machines.filter((machine) => connectedMachineIds.has(machine.machineId)),
    [machines, connectedMachineIds]
  );

  // Exactly one connected machine is selected automatically. Derived, so no effect is needed.
  const activeMachineId =
    chosenMachineId ?? (connectedMachines.length === 1 ? connectedMachines[0].machineId : null);
  const activeMachine = machines.find((machine) => machine.machineId === activeMachineId) ?? null;

  // Escape cancels on the machine step only. The workspace step handles its own Escape, because it
  // owns the clone state that decides whether leaving needs a confirm. The agents step ignores it.
  useEffect(() => {
    if (step !== 'machine') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [step, onCancel]);

  const handleContinue = useCallback(() => {
    if (activeMachineId && connectedMachineIds.has(activeMachineId)) setStep('workspace');
  }, [activeMachineId, connectedMachineIds]);

  const handleWorkspaceReady = useCallback(
    async (workingDir: string) => {
      if (creatingRef.current || !activeMachineId) return;
      creatingRef.current = true;
      setIsCreating(true);
      setCreateError(null);
      try {
        const result = await createWithWorkspace({
          teamStructureId: TEAMS_CONFIG.defaultTeam,
          machineId: activeMachineId,
          workingDir,
        });
        setCreated({ chatroomId: result.chatroomId, machineId: activeMachineId, workingDir });
        setStep('agents');
      } catch (error) {
        setCreateError(messageFromError(error));
      } finally {
        creatingRef.current = false;
        setIsCreating(false);
      }
    },
    [activeMachineId, createWithWorkspace]
  );

  const handleBackToMachine = useCallback(() => {
    setCreateError(null);
    setStep('machine');
  }, []);

  const renderStep = () => {
    if (step === 'machine') {
      return (
        <NewChatroomMachineStep
          machines={machines}
          connectedMachineIds={connectedMachineIds}
          isLoading={isLoading}
          selectedMachineId={activeMachineId}
          onSelectMachine={setChosenMachineId}
          onContinue={handleContinue}
          onCancel={onCancel}
        />
      );
    }
    if (step === 'workspace') {
      return (
        <WorkspaceStepView
          machine={activeMachine}
          connectedMachineIds={connectedMachineIds}
          isCreating={isCreating}
          createError={createError}
          onBack={handleBackToMachine}
          onCancel={onCancel}
          onWorkspaceReady={handleWorkspaceReady}
        />
      );
    }
    return (
      <AgentsStepView
        created={created}
        connectedMachines={connectedMachines}
        onCreated={onCreated}
      />
    );
  };

  return (
    <div className="bg-chatroom-bg-surface backdrop-blur-xl border-2 border-chatroom-border-strong w-full max-w-3xl mx-auto">
      <div className="p-6 border-b-2 border-chatroom-border">
        <h2 className="text-sm font-bold uppercase tracking-widest text-chatroom-text-primary m-0">
          New Chatroom
        </h2>
        <p className="text-chatroom-text-muted text-xs mt-2 m-0">
          Step {STEP_NUMBER[step]} of 3 · {STEP_LABEL[step]}
        </p>
      </div>
      <div className="p-6 min-h-[24rem]">{renderStep()}</div>
    </div>
  );
}
