'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { messageFromError } from './lib/errorMessage';
import { NewChatroomAgentsStep } from './NewChatroomAgentsStep';
import { NewChatroomMachineStep } from './NewChatroomMachineStep';
import { NewChatroomWorkspaceStep } from './NewChatroomWorkspaceStep';
import { pickDefaultMachineId } from '../../components/setup/pickDefaultMachineId';
import { TEAMS_CONFIG } from '../../config/teams';
import type { UserMachine } from '../../types/machine';

import { useConnectedMachines } from '@/hooks/useConnectedMachines';

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

/**
 * Creates the chatroom in one call, and only after a folder is chosen. A synchronous guard stops a
 * second create while one is in flight. A failure keeps the user on the step, with the message.
 */
function useCreateChatroom({
  activeMachineId,
  onCreated,
}: {
  activeMachineId: string | null;
  onCreated: () => void;
}) {
  const createWithWorkspace = useSessionMutation(api.chatrooms.createWithWorkspace);
  const [created, setCreated] = useState<CreatedChatroom | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Synchronous guard: a second click before React re-renders must not create a second chatroom.
  const creatingRef = useRef(false);

  const createFromFolder = useCallback(
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
        onCreated();
      } catch (error) {
        setCreateError(messageFromError(error));
      } finally {
        creatingRef.current = false;
        setIsCreating(false);
      }
    },
    [activeMachineId, createWithWorkspace, onCreated]
  );

  const clearError = useCallback(() => setCreateError(null), []);
  return { created, createError, isCreating, createFromFolder, clearError };
}

/**
 * Escape cancels on the machine step only. The workspace step handles its own Escape, because it
 * owns the clone state that decides whether leaving needs a confirm. The agents step ignores it.
 */
function useMachineStepEscape(step: WizardStep, onCancel: () => void) {
  useEffect(() => {
    if (step !== 'machine') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [step, onCancel]);
}

function WizardHeader({ step }: { step: WizardStep }) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-3 border-b-2 border-chatroom-border px-4 py-3 sm:px-6 sm:py-4">
      <h2 className="text-sm font-bold uppercase tracking-widest text-chatroom-text-primary m-0">
        New Chatroom
      </h2>
      <p className="text-chatroom-text-muted text-xs mt-2 m-0">
        Step {STEP_NUMBER[step]} of 3 · {STEP_LABEL[step]}
      </p>
    </div>
  );
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

type CreateFlow = ReturnType<typeof useCreateChatroom>;

interface WizardStepBodyProps {
  step: WizardStep;
  machines: UserMachine[];
  isLoading: boolean;
  connectedMachineIds: ReadonlySet<string>;
  connectedMachines: UserMachine[];
  activeMachineId: string | null;
  activeMachine: UserMachine | null;
  create: CreateFlow;
  onSelectMachine: (machineId: string | null) => void;
  onContinue: () => void;
  onBack: () => void;
  onCancel: () => void;
  onCreated: (chatroomId: string) => void;
}

/** Renders the current step. Each step is its own view, so this only picks one. */
function WizardStepBody({
  step,
  machines,
  isLoading,
  connectedMachineIds,
  connectedMachines,
  activeMachineId,
  activeMachine,
  create,
  onSelectMachine,
  onContinue,
  onBack,
  onCancel,
  onCreated,
}: WizardStepBodyProps) {
  if (step === 'machine') {
    return (
      <NewChatroomMachineStep
        machines={machines}
        connectedMachineIds={connectedMachineIds}
        isLoading={isLoading}
        selectedMachineId={activeMachineId}
        onSelectMachine={onSelectMachine}
        onContinue={onContinue}
        onCancel={onCancel}
      />
    );
  }
  if (step === 'workspace') {
    return (
      <WorkspaceStepView
        machine={activeMachine}
        connectedMachineIds={connectedMachineIds}
        isCreating={create.isCreating}
        createError={create.createError}
        onBack={onBack}
        onCancel={onCancel}
        onWorkspaceReady={create.createFromFolder}
      />
    );
  }
  return (
    <AgentsStepView
      created={create.created}
      connectedMachines={connectedMachines}
      onCreated={onCreated}
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

  // The machine step lists offline machines too, but only connected machines can be picked.
  const { machines, isLoading, connectedMachines, connectedMachineIds } = useConnectedMachines();

  // Exactly one connected machine is selected automatically. Derived, so no effect is needed.
  const activeMachineId = pickDefaultMachineId(connectedMachines, chosenMachineId);
  const activeMachine = machines.find((machine) => machine.machineId === activeMachineId) ?? null;

  const handleCreated = useCallback(() => setStep('agents'), []);
  const create = useCreateChatroom({ activeMachineId, onCreated: handleCreated });
  useMachineStepEscape(step, onCancel);

  const handleContinue = useCallback(() => {
    if (activeMachineId && connectedMachineIds.has(activeMachineId)) setStep('workspace');
  }, [activeMachineId, connectedMachineIds]);

  const { clearError } = create;
  const handleBackToMachine = useCallback(() => {
    clearError();
    setStep('machine');
  }, [clearError]);

  return (
    <div className="flex h-dvh w-full flex-col bg-chatroom-bg-surface backdrop-blur-xl sm:h-[min(40rem,calc(100dvh-6rem))] sm:max-w-2xl sm:border-2 sm:border-chatroom-border-strong">
      <WizardHeader step={step} />
      <div className="flex min-h-0 flex-1 flex-col">
        <WizardStepBody
          step={step}
          machines={machines}
          isLoading={isLoading}
          connectedMachineIds={connectedMachineIds}
          connectedMachines={connectedMachines}
          activeMachineId={activeMachineId}
          activeMachine={activeMachine}
          create={create}
          onSelectMachine={setChosenMachineId}
          onContinue={handleContinue}
          onBack={handleBackToMachine}
          onCancel={onCancel}
          onCreated={onCreated}
        />
      </div>
    </div>
  );
}
