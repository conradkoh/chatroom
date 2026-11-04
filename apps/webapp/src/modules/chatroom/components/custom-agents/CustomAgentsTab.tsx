'use client';

/**
 * Custom Agents settings tab.
 *
 * Renders every state of the design — loading, query error with retry,
 * unsupported team, no primary workspace, daemon offline, empty, and loaded —
 * from the S6a view model. The roster subscription lives in `CustomAgentsContent`
 * so it only exists while the tab is open.
 *
 * Toggling is intentionally not optimistic: the row shows the roster's value, and
 * only a fresh roster can change it.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { AlertTriangle, Info, RotateCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { CustomAgentRow } from './CustomAgentRow';
import { CustomAgentsEmptyState } from './CustomAgentsEmptyState';
import { resolveCustomAgentsGate, type CustomAgentsGate } from './customAgentsGate';
import { CustomAgentSourceSection } from './CustomAgentSourceSection';
import { CustomAgentsRescanButton } from './CustomAgentsRescanButton';
import {
  buildCustomAgentsViewModel,
  overLimitNames,
  type CustomAgentRowModel,
  type CustomAgentSourceModel,
  type CustomAgentsViewModel,
  type TeamRosterResult,
} from './customAgentsViewModel';
import { useCustomAgentToggle } from './useCustomAgentToggle';
import { useChatroomWorkspace } from '../../context/ChatroomWorkspaceContext';
import { useChatroomTeam } from '../../hooks/useChatroomTeam';
import { getWorkspaceDisplayHostname } from '../../types/workspace';
import type { Workspace } from '../../types/workspace';
import type { SettingsTab } from '../CommandPalette/types';
import { CopyButton } from '../CopyButton';
import { ErrorBoundary } from '../ErrorBoundary';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDaemonConnected } from '@/hooks/useDaemonConnected';
import { getDaemonStartCommand } from '@/lib/environment';

export interface CustomAgentsTabProps {
  chatroomId: string;
  onOpenTab: (tab: SettingsTab) => void;
}

/** Stable empty set, so a missing model keeps the hook's reconcile dependencies identical. */
const NO_NAMES: ReadonlySet<string> = new Set();

export function CustomAgentsTab({ chatroomId, onOpenTab }: CustomAgentsTabProps) {
  const [attempt, setAttempt] = useState(0);

  return (
    <ErrorBoundary
      key={attempt}
      fallback={<CustomAgentsQueryError onRetry={() => setAttempt((value) => value + 1)} />}
    >
      <CustomAgentsContent chatroomId={chatroomId} onOpenTab={onOpenTab} />
    </ErrorBoundary>
  );
}

function CustomAgentsContent({ chatroomId, onOpenTab }: CustomAgentsTabProps) {
  const team = useChatroomTeam(chatroomId);
  const { activeWorkspace, isLoading: workspaceLoading } = useChatroomWorkspace();
  const roster = useSessionQuery(api.customAgents.getTeamRoster, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const daemon = useDaemonConnected(machineIdOf(activeWorkspace));

  const model = useMemo(() => buildModel(roster, activeWorkspace), [roster, activeWorkspace]);
  const overLimit = useMemo(() => overLimitNamesOf(model), [model]);
  const toggle = useCustomAgentToggle({
    chatroomId,
    rows: rowsOf(model),
    overLimitNames: overLimit,
  });
  const view = deriveView({ team, workspaceLoading, roster, activeWorkspace, daemon, model });

  return (
    <div className="space-y-6" data-testid="custom-agents-tab">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CustomAgentsHeaderDescription />
        {view.showRescan && (
          <CustomAgentsRescanButton
            chatroomId={chatroomId}
            canRescan={view.canRescan}
            disabledReason={view.disabledReason}
            changeSignature={view.changeSignature}
          />
        )}
      </div>
      {view.offline && <CustomAgentsOfflineBanner hostname={view.hostname} />}
      <CustomAgentsGateView
        gate={view.gate}
        model={model}
        toggle={toggle}
        offline={view.offline}
        hostname={view.hostname}
        teamId={team.teamId}
        teamName={team.teamName}
        onOpenTab={onOpenTab}
      />
    </div>
  );
}

interface ViewInput {
  team: ReturnType<typeof useChatroomTeam>;
  workspaceLoading: boolean;
  roster: TeamRosterResult | undefined;
  activeWorkspace: Workspace | null;
  daemon: { isConnected: boolean; isLoading: boolean };
  model: CustomAgentsViewModel | null;
}

interface View {
  gate: CustomAgentsGate;
  offline: boolean;
  showRescan: boolean;
  canRescan: boolean;
  disabledReason: string | null;
  changeSignature: string | null;
  hostname: string;
}

/** Every derived value the layout needs, in one pure place. */
function deriveView(input: ViewInput): View {
  const offline = isOffline(input.daemon, input.activeWorkspace);
  const gate = resolveGateFor(input);

  return {
    gate,
    offline,
    showRescan: showsRescan(gate),
    canRescan: hasModel(input.model) && !offline,
    disabledReason: reasonFor(input.model, offline),
    changeSignature: signatureOf(input.model),
    hostname: hostnameFor(input.activeWorkspace),
  };
}

function resolveGateFor(input: ViewInput): CustomAgentsGate {
  return resolveCustomAgentsGate({
    isLoading: isViewLoading(input),
    roster: input.roster,
    teamId: input.team.teamId,
    hasWorkspace: input.activeWorkspace !== null,
    rowCount: rowCountOf(input.model),
  });
}

function isViewLoading(input: ViewInput): boolean {
  return input.team.isLoading || input.workspaceLoading || input.roster === undefined;
}

function rowCountOf(model: CustomAgentsViewModel | null): number {
  return model === null ? 0 : model.rows.length;
}

function showsRescan(gate: CustomAgentsGate): boolean {
  return gate !== 'unsupported' && gate !== 'no-workspace';
}

function hasModel(model: CustomAgentsViewModel | null): boolean {
  return model !== null;
}

function reasonFor(model: CustomAgentsViewModel | null, offline: boolean): string | null {
  if (model === null) return 'Loading…';
  return offline ? 'Daemon offline.' : null;
}

function signatureOf(model: CustomAgentsViewModel | null): string | null {
  return model === null ? null : model.changeSignature;
}

function hostnameFor(workspace: Workspace | null): string {
  return workspace === null ? 'this machine' : getWorkspaceDisplayHostname(workspace);
}

function isOffline(
  daemon: { isConnected: boolean; isLoading: boolean },
  activeWorkspace: Workspace | null
): boolean {
  return !daemon.isLoading && !daemon.isConnected && activeWorkspace !== null;
}

function machineIdOf(workspace: Workspace | null): string | null {
  return workspace === null ? null : workspace.machineId;
}

function rowsOf(model: CustomAgentsViewModel | null): CustomAgentRowModel[] {
  return model === null ? [] : model.rows;
}

function overLimitNamesOf(model: CustomAgentsViewModel | null): ReadonlySet<string> {
  return model === null ? NO_NAMES : overLimitNames(model.sources);
}

function buildModel(
  roster: TeamRosterResult | undefined,
  workspace: Workspace | null
): CustomAgentsViewModel | null {
  if (roster === undefined || workspace === null) return null;
  return buildCustomAgentsViewModel(roster, workspace.workingDir);
}

function CustomAgentsHeaderDescription(): ReactNode {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
        Custom Agents
      </h3>
      <p className="text-xs text-chatroom-text-muted">
        Roles you write as AGENT.md files. They join this chatroom&apos;s Duo team as optional
        agents. Edit the files in your editor. This page shows what the machine loaded.
      </p>
    </div>
  );
}

function CustomAgentsGateView({
  gate,
  model,
  toggle,
  offline,
  hostname,
  teamId,
  teamName,
  onOpenTab,
}: {
  gate: CustomAgentsGate;
  model: CustomAgentsViewModel | null;
  toggle: ReturnType<typeof useCustomAgentToggle>;
  offline: boolean;
  hostname: string;
  teamId: string | undefined;
  teamName: string | undefined;
  onOpenTab: (tab: SettingsTab) => void;
}): ReactNode {
  if (gate === 'loading') return <CustomAgentRowsSkeleton />;
  if (gate === 'empty' || gate === 'loaded') {
    return (
      <CustomAgentsRosterView
        gate={gate}
        model={model}
        toggle={toggle}
        offline={offline}
        hostname={hostname}
      />
    );
  }
  return (
    <CustomAgentsStaticGate gate={gate} teamId={teamId} teamName={teamName} onOpenTab={onOpenTab} />
  );
}

function CustomAgentsStaticGate({
  gate,
  teamId,
  teamName,
  onOpenTab,
}: {
  gate: CustomAgentsGate;
  teamId: string | undefined;
  teamName: string | undefined;
  onOpenTab: (tab: SettingsTab) => void;
}): ReactNode {
  if (gate === 'unsupported') {
    return (
      <CustomAgentsGateCard
        message={unsupportedMessage(teamId, teamName)}
        actionLabel="Open Team tab"
        onAction={() => onOpenTab('team')}
      />
    );
  }
  return (
    <CustomAgentsGateCard
      message="Custom agents load from this chatroom's primary workspace. This chatroom has none yet."
      actionLabel="Open Workspaces tab"
      onAction={() => onOpenTab('workspaces')}
    />
  );
}

function unsupportedMessage(teamId: string | undefined, teamName: string | undefined): string {
  if (teamId === undefined) {
    return 'Custom agents work only with the Duo team. This chatroom has no team yet.';
  }
  return `Custom agents work only with the Duo team. This chatroom uses ${teamName ?? teamId}.`;
}

function CustomAgentsRosterView({
  gate,
  model,
  toggle,
  offline,
  hostname,
}: {
  gate: CustomAgentsGate;
  model: CustomAgentsViewModel | null;
  toggle: ReturnType<typeof useCustomAgentToggle>;
  offline: boolean;
  hostname: string;
}): ReactNode {
  if (model === null) return null;

  return (
    <div className="space-y-6">
      {gate === 'loaded' ? (
        <CustomAgentsRows rows={model.rows} toggle={toggle} offline={offline} hostname={hostname} />
      ) : (
        <CustomAgentsEmptyState
          workspaceRoot={model.sources[0].rootPath}
          hasIssues={model.issueCount > 0}
        />
      )}
      {hasPushedSource(model) && <CustomAgentsSources model={model} toggle={toggle} />}
    </div>
  );
}

function hasPushedSource(model: CustomAgentsViewModel): boolean {
  return model.sources.some((source) => source.pushed !== null);
}

function CustomAgentsRows({
  rows,
  toggle,
  offline,
  hostname,
}: {
  rows: CustomAgentRowModel[];
  toggle: ReturnType<typeof useCustomAgentToggle>;
  offline: boolean;
  hostname: string;
}): ReactNode {
  const enabled = rows.filter((row) => !row.disabled).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Agents
        </h4>
        <span className="text-[10px] font-bold uppercase tracking-wide tabular-nums text-chatroom-text-muted">
          {enabled} on · {rows.length - enabled} off
        </span>
      </div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <CustomAgentRow
            key={row.name}
            row={row}
            toggle={toggle.stateFor(row.name)}
            controlsDisabled={offline}
            onToggle={toggle.requestToggle}
          />
        ))}
      </ul>
      <CustomAgentsMachineWideNote hostname={hostname} />
    </div>
  );
}

function CustomAgentsSources({
  model,
  toggle,
}: {
  model: CustomAgentsViewModel;
  toggle: ReturnType<typeof useCustomAgentToggle>;
}): ReactNode {
  const overLimitMessages = overLimitFailureMessages(toggle, model.sources);

  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        Sources
      </h4>
      {model.sources.map((source) => (
        <CustomAgentSourceSection
          key={source.scope}
          source={source}
          overLimitFailures={overLimitMessages}
        />
      ))}
    </div>
  );
}

/**
 * Message to show on each over-limit source issue, keyed by agent name. The cap
 * removes those agents from the roster, so the issue that names them is the only
 * place the message can ride — whether this user toggled the agent or the enable
 * pushed it out.
 */
function overLimitFailureMessages(
  toggle: ReturnType<typeof useCustomAgentToggle>,
  sources: readonly CustomAgentSourceModel[]
): ReadonlyMap<string, string> {
  const messages = new Map<string, string>();
  for (const name of overLimitNames(sources)) {
    const state = toggle.stateFor(name);
    if (state.kind === 'failed') messages.set(name, state.message);
  }
  return messages;
}

function CustomAgentsMachineWideNote({ hostname }: { hostname: string }): ReactNode {
  return (
    <p className="flex items-start gap-2 p-3 bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] text-chatroom-text-secondary">
      <Info size={12} className="mt-0.5 shrink-0 text-chatroom-text-muted" aria-hidden />
      Turning an agent off applies to every agent with that name on {hostname}, in every chatroom
      and in both scopes. An agent that is already working keeps working on its current task.
    </p>
  );
}

function CustomAgentsGateCard({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}): ReactNode {
  return (
    <div
      data-testid="custom-agents-gate"
      className="space-y-3 p-4 border border-chatroom-border bg-chatroom-bg-tertiary"
    >
      <p className="text-xs text-chatroom-text-secondary">{message}</p>
      <Button variant="outline" size="sm" className="text-xs" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

function CustomAgentsOfflineBanner({ hostname }: { hostname: string }): ReactNode {
  const command = getDaemonStartCommand();

  return (
    <div
      data-testid="custom-agents-daemon-offline"
      className="space-y-2 p-3 bg-chatroom-status-warning/10 border border-chatroom-status-warning/30"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          className="text-chatroom-status-warning shrink-0 mt-0.5"
          aria-hidden
        />
        <p className="text-[10px] text-chatroom-text-secondary">
          The daemon on {hostname} is offline. Start it to turn agents on or off, or to rescan. The
          list below may be out of date.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[10px] font-mono text-chatroom-status-success bg-chatroom-bg-tertiary px-2 py-1.5 border border-chatroom-border break-all">
          {command}
        </code>
        <CopyButton text={command} label="Copy" copiedLabel="Copied!" variant="compact" />
      </div>
    </div>
  );
}

function CustomAgentRowsSkeleton(): ReactNode {
  return (
    <ul className="space-y-1" aria-busy="true" aria-label="Loading custom agents">
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          data-testid="custom-agent-row-skeleton"
          className="flex min-h-[4.75rem] items-start gap-3 p-3 border border-chatroom-border bg-chatroom-bg-surface"
        >
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40 rounded-none bg-chatroom-bg-tertiary" />
            <Skeleton className="h-3 w-full rounded-none bg-chatroom-bg-tertiary" />
            <Skeleton className="h-3 w-2/3 rounded-none bg-chatroom-bg-tertiary" />
          </div>
          <Skeleton className="h-[18.4px] w-8 rounded-full bg-chatroom-bg-tertiary" />
        </li>
      ))}
    </ul>
  );
}

function CustomAgentsQueryError({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div className="space-y-6" data-testid="custom-agents-tab">
      <CustomAgentsHeaderDescription />
      <div
        role="alert"
        data-testid="custom-agents-error"
        className="flex flex-col items-start gap-3 p-4 border border-chatroom-border bg-chatroom-bg-tertiary"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0 text-chatroom-status-error"
            aria-hidden
          />
          <div>
            <p className="text-xs font-bold text-chatroom-text-primary">
              Could not load custom agents
            </p>
            <p className="text-[11px] text-chatroom-text-muted">
              Check your connection, then try again.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={onRetry}>
          <RotateCw size={14} />
          Retry
        </Button>
      </div>
    </div>
  );
}
