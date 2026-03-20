'use client';

import { Rocket, Check } from 'lucide-react';
import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React, { useMemo, memo } from 'react';

import { InlineAgentCard } from './AgentPanel/InlineAgentCard';
import { CopyButton } from './CopyButton';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
import { useAgentStatuses } from '../hooks/useAgentStatuses';

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
  // ── Panel data (machines, configs, send command) ───────────────────
  const {
    agents: agentRoleViews,
    connectedMachines,
    machineConfigs,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  // ── Agent statuses (event stream) ─────────────────────────────────
  const { agents: agentStatuses, isLoading: isLoadingStatuses } = useAgentStatuses(
    chatroomId,
    teamRoles
  );

  // Combined loading flag — wait for both machine data and agent statuses before rendering
  const isAllLoading = isLoading || isLoadingStatuses;
  const agentStatusMap = useMemo(
    () => new Map(agentStatuses.map((a) => [a.role.toLowerCase(), a])),
    [agentStatuses]
  );

  // Build a role → AgentRoleView map for InlineAgentCard
  const agentRoleViewMap = useMemo(
    () => new Map(agentRoleViews.map((a) => [a.role.toLowerCase(), a])),
    [agentRoleViews]
  );

  // ── Restart summaries (batch query) ────────────────────────────────
  // Batch query all restart summaries for team roles in a single subscription
  const restartSummaries = useSessionQuery(api.machines.getAgentRestartSummariesByRoles, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles: teamRoles,
  });

  // Build a map of role -> restart summary for efficient lookup
  const restartSummaryMap = useMemo(() => {
    const map = new Map<string, { count1h: number; count24h: number }>();
    if (restartSummaries) {
      for (const summary of restartSummaries) {
        map.set(summary.role.toLowerCase(), {
          count1h: summary.count1h,
          count24h: summary.count24h,
        });
      }
    }
    return map;
  }, [restartSummaries]);

  // ── Prerequisites ─────────────────────────────────────────────────
  const prereqs = useMemo<Prerequisites>(() => {
    const authDone = connectedMachines.length > 0; // any connected machine = auth done
    const daemonDone = connectedMachines.length > 0;
    const harnessDone = connectedMachines.some((m) => m.availableHarnesses.length > 0);
    return { authDone, daemonDone, harnessDone };
  }, [connectedMachines]);

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

  // ── Loading guard ─────────────────────────────────────────────────
  // Show skeleton rows while machine data is loading to prevent the
  // prerequisites flashing as "not done" before data arrives.
  if (isAllLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
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
        <div className="flex flex-col gap-6">
          {/* Prerequisites skeleton */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
              Prerequisites
            </h3>
            <div className="flex flex-col gap-2">
              {['Auth login', 'Daemon connected', 'Harness installed'].map((label) => (
                <div key={label} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="w-4 h-4 flex-shrink-0 bg-chatroom-border animate-pulse" />
                  <span className="text-xs font-medium text-chatroom-text-muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Agents skeleton */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
              Agents
            </h3>
            <div className="flex flex-col border border-chatroom-border">
              {teamRoles.map((role) => (
                <div
                  key={role}
                  className="flex items-center gap-2 px-4 py-3 border-b border-chatroom-border last:border-b-0"
                >
                  <div className="w-2 h-2 flex-shrink-0 bg-chatroom-border animate-pulse rounded-full" />
                  <span className="text-xs font-medium text-chatroom-text-muted uppercase tracking-wide">
                    {role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

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

          {/* Agents section — uses InlineAgentCard for parity with All Agents panel */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
              Agents
            </h3>
            {/* InlineAgentCard uses border-b / last:border-b-0 internally; wrap in a container border */}
            <div className="border border-chatroom-border">
              {teamRoles.map((role) => {
                const agentStatus = agentStatusMap.get(role.toLowerCase());
                const agentRoleView = agentRoleViewMap.get(role.toLowerCase());
                return (
                  <InlineAgentCard
                    key={role}
                    role={role}
                    allRoles={teamRoles}
                    online={agentStatus?.online ?? false}
                    lastSeenAt={agentStatus?.lastSeenAt ?? null}
                    latestEventType={agentStatus?.latestEventType ?? null}
                    statusVariant={agentStatus?.statusVariant}
                    prompt=""
                    chatroomId={chatroomId}
                    connectedMachines={connectedMachines}
                    isLoadingMachines={isLoading}
                    agentConfigs={machineConfigs}
                    sendCommand={sendCommand}
                    agentRoleView={agentRoleView}
                    agentPreference={agentPreferenceMap.get(role.toLowerCase())}
                    onSavePreference={savePreference}
                    restartSummary={restartSummaryMap.get(role.toLowerCase())}
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
