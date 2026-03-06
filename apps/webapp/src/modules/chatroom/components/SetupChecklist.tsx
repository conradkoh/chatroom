'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { Rocket, Check, Play } from 'lucide-react';
import React, { useMemo, useState, memo } from 'react';

import { AgentStartModal } from './AgentStartModal';
import { CopyButton } from './CopyButton';
import type { MachineInfo } from '../types/machine';

import { getDaemonStartCommand, getAuthLoginCommand } from '@/lib/environment';

// ─── Types ──────────────────────────────────────────────────────────

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupChecklistProps {
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt: (role: string) => void;
  /** Hide the header section (used when rendered inside a modal with its own header) */
  hideHeader?: boolean;
}

interface Prerequisites {
  /** Machine has registered = CLI auth done */
  authDone: boolean;
  /** At least one connected machine has an available harness */
  harnessDone: boolean;
  /** At least one machine is connected to daemon */
  daemonDone: boolean;
}

// ─── PrerequisiteRow ────────────────────────────────────────────────

interface PrerequisiteRowProps {
  done: boolean;
  label: string;
  command?: string;
  doneDetail?: string;
}

function PrerequisiteRow({ done, label, command, doneDetail }: PrerequisiteRowProps) {
  // Completed rows: compact single line, no heavy border
  if (done) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-chatroom-status-success">
          <Check size={14} />
        </span>
        <span className="text-xs font-medium text-chatroom-status-success">{label}</span>
        {doneDetail && <span className="text-xs text-chatroom-text-muted">— {doneDetail}</span>}
      </div>
    );
  }

  // Pending rows: full card with command block
  return (
    <div className="flex flex-col gap-2 p-4 border border-chatroom-border bg-chatroom-bg-surface">
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-chatroom-text-muted">
          <span className="w-1.5 h-1.5 bg-chatroom-status-warning rounded-full" />
        </span>
        <span className="text-sm font-semibold text-chatroom-text-primary">{label}</span>
      </div>
      {command && (
        <div className="ml-6 flex items-start gap-2 p-3 bg-chatroom-bg-primary">
          <pre className="font-mono text-xs text-chatroom-text-secondary flex-1 whitespace-pre-wrap">
            {command}
          </pre>
          <CopyButton text={command} label="Copy" copiedLabel="Copied!" variant="compact" />
        </div>
      )}
    </div>
  );
}

// ─── AgentRow ───────────────────────────────────────────────────────

interface AgentRowProps {
  role: string;
  isJoined: boolean;
  canStart: boolean;
  chatroomId: string;
  knownRoles: string[];
}

function AgentRow({ role, isJoined, canStart, chatroomId, knownRoles }: AgentRowProps) {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <div
        className={`flex items-center justify-between px-4 py-3 border ${
          isJoined
            ? 'border-chatroom-status-success/20 bg-chatroom-status-success/5'
            : 'border-chatroom-border bg-chatroom-bg-surface'
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-4 h-4 flex-shrink-0 flex items-center justify-center ${
              isJoined ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'
            }`}
          >
            {isJoined ? (
              <Check size={14} />
            ) : (
              <span className="w-1.5 h-1.5 bg-chatroom-status-warning rounded-full" />
            )}
          </span>
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            {role}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              isJoined
                ? 'bg-chatroom-status-success/15 text-chatroom-status-success'
                : 'bg-chatroom-status-warning/15 text-chatroom-status-warning'
            }`}
          >
            {isJoined ? 'Ready' : 'Waiting'}
          </span>
          {!isJoined && canStart && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors"
            >
              <Play size={10} />
              Start
            </button>
          )}
        </div>
      </div>
      {/* Always mount modal so it's ready when opened */}
      <AgentStartModal
        chatroomId={chatroomId}
        open={modalOpen}
        onOpenChange={setModalOpen}
        initialRole={role}
        knownRoles={knownRoles}
      />
    </>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export const SetupChecklist = memo(function SetupChecklist({
  chatroomId,
  teamName: _teamName,
  teamRoles,
  teamEntryPoint: _teamEntryPoint,
  participants,
  onViewPrompt,
  hideHeader = false,
}: SetupChecklistProps) {
  // ── Machine data ──────────────────────────────────────────────────
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const allMachines = useMemo(() => machinesResult?.machines ?? [], [machinesResult?.machines]);

  const connectedMachines = useMemo(
    () => allMachines.filter((m) => m.daemonConnected),
    [allMachines]
  );

  // ── Prerequisites ─────────────────────────────────────────────────
  const prereqs = useMemo<Prerequisites>(() => {
    const authDone = allMachines.length > 0;
    const daemonDone = connectedMachines.length > 0;
    const harnessDone = connectedMachines.some((m) => m.availableHarnesses.length > 0);
    return { authDone, daemonDone, harnessDone };
  }, [allMachines, connectedMachines]);

  // ── Participants ──────────────────────────────────────────────────
  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.role.toLowerCase(), p])),
    [participants]
  );

  const joinedCount = useMemo(
    () =>
      teamRoles.filter((role) => {
        const p = participantMap.get(role.toLowerCase());
        return p != null && p.lastSeenAt != null;
      }).length,
    [teamRoles, participantMap]
  );

  const unjoinedRoles = useMemo(
    () =>
      teamRoles.filter((role) => {
        const p = participantMap.get(role.toLowerCase());
        return p == null || p.lastSeenAt == null;
      }),
    [teamRoles, participantMap]
  );

  // ── Commands ──────────────────────────────────────────────────────
  const daemonStartCommand = getDaemonStartCommand();
  const authLoginCommand = getAuthLoginCommand(window.location.origin);

  // ── Harness detail ────────────────────────────────────────────────
  const detectedHarnesses = useMemo(() => {
    const all = connectedMachines.flatMap((m) => m.availableHarnesses);
    return [...new Set(all)];
  }, [connectedMachines]);

  const harnessInstallCommand =
    '# Install a supported harness:\nnpm install -g opencode-ai   # opencode\nnpm install -g @plandex/pi   # pi';

  const allJoined = joinedCount === teamRoles.length && teamRoles.length > 0;

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header - hidden when used in modal */}
      {!hideHeader && (
        <div className="mb-6 pb-6 border-b-2 border-chatroom-border">
          <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-chatroom-text-primary mb-2">
            <Rocket size={20} /> Setup Your Team
          </h2>
          <p className="text-sm text-chatroom-text-muted">
            {joinedCount} of {teamRoles.length} agents ready
          </p>
        </div>
      )}

      {/* All-done success banner */}
      {allJoined ? (
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <div className="w-12 h-12 bg-chatroom-status-success flex items-center justify-center">
            <Check size={24} className="text-chatroom-bg-primary" />
          </div>
          <h2 className="text-lg font-bold uppercase tracking-widest text-chatroom-text-primary">
            All Agents Ready
          </h2>
          <p className="text-sm text-chatroom-text-muted">
            {teamRoles.length} of {teamRoles.length} agents are online
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Prerequisites section */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
              Prerequisites
            </h3>
            <div className="flex flex-col gap-2">
              <PrerequisiteRow
                done={prereqs.authDone}
                label="Auth login"
                command={authLoginCommand}
                doneDetail="CLI is authenticated"
              />
              <PrerequisiteRow
                done={prereqs.daemonDone}
                label="Daemon connected"
                command={daemonStartCommand}
                doneDetail={`${connectedMachines.length} machine${connectedMachines.length !== 1 ? 's' : ''} connected`}
              />
              <PrerequisiteRow
                done={prereqs.harnessDone}
                label="Harness installed"
                command={harnessInstallCommand}
                doneDetail={`${detectedHarnesses.join(', ')} detected`}
              />
            </div>
          </div>

          {/* Agents section */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
              Agents
            </h3>
            <div className="flex flex-col gap-2">
              {teamRoles.map((role) => {
                const participant = participantMap.get(role.toLowerCase());
                const isJoined = participant != null && participant.lastSeenAt != null;
                return (
                  <AgentRow
                    key={role}
                    role={role}
                    isJoined={isJoined}
                    canStart={prereqs.daemonDone}
                    chatroomId={chatroomId}
                    knownRoles={teamRoles}
                  />
                );
              })}
            </div>
          </div>

          {/* Or run manually section */}
          {unjoinedRoles.length > 0 && (
            <div className="pt-4 border-t border-chatroom-border">
              <p className="text-xs text-chatroom-text-muted mb-2">Or run manually:</p>
              <div className="flex flex-col gap-1">
                {unjoinedRoles.map((role) => (
                  <button
                    key={role}
                    onClick={() => onViewPrompt(role)}
                    className="text-xs text-left text-chatroom-text-muted hover:text-chatroom-text-secondary underline underline-offset-2 transition-colors"
                  >
                    → View prompt for {role}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
