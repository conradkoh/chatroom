'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useQueries, type RequestForQueries } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentHarness } from '../../../types/machine';
import { applyFavoriteConfigs, type ApplyFavoriteConfigItem } from '../lib/applyFavoriteConfigs';
import {
  favoritesKey,
  findFavoriteMismatches,
  type FavoriteMismatch,
  type StartCheckLaunchRequest,
  type StartCheckWorkspace,
} from '../lib/favoriteStartMismatches';
import { buildMachineFavoriteScopeKey } from '../lib/machineConfigScopeKey';
import type { MachineConfigEntry } from '../types/machineConfig';

export const START_FAVORITES_CHECK_TIMEOUT_MS = 4000;

export type StartFlowPhase =
  'idle' | 'checking' | 'prompt' | 'applying' | 'apply-error' | 'starting';

export interface StartFavoriteFailure {
  role: string;
  workspaceLabel: string;
  message: string;
}

/** Props of `components/StartWithFavoritesDialog.tsx` (built in a later slice). Lives here so the controller compiles alone. */
export interface StartWithFavoritesDialogProps {
  open: boolean;
  phase: StartFlowPhase;
  mismatches: readonly FavoriteMismatch[];
  failures: readonly StartFavoriteFailure[];
  showWorkspaceLabels: boolean;
  onUseFavourites: () => void;
  onStartWithCurrent: () => void;
  onStartAnyway: () => void;
  onCancel: () => void;
}

export interface UseStartAgentsWithFavoritesOptions {
  chatroomId: string;
  /** The caller's existing start + toast code. Resolves when the start request finished. */
  start: (info: { appliedCount: number }) => Promise<void>;
}

export interface UseStartAgentsWithFavoritesResult {
  phase: StartFlowPhase;
  isBusy: boolean;
  requestStart: () => void;
  dialogProps: StartWithFavoritesDialogProps;
}

// ── Query result shapes (only the fields read here) ─────────────────────────
type TeamStructureResult = { teamId: string; roles: { role: string }[] } | null;
type WorkspaceRow = {
  _id: string;
  machineId: string;
  workingDir: string;
  hostname: string;
  machineAlias?: string;
};
type StatusRow = { role: string; isRunning: boolean };
type CapabilitiesResult = { availableHarnesses: AgentHarness[] };
type FavoritesResult = { favorites?: MachineConfigEntry[] };

// ── Pure helpers ────────────────────────────────────────────────────────────
type Settled = 'pending' | 'error' | 'ready';

/** Any `Error` wins; any `undefined` means pending; an empty set is ready. */
function settle(results: Record<string, unknown>): Settled {
  let state: Settled = 'ready';
  for (const value of Object.values(results)) {
    if (value instanceof Error) return 'error';
    if (value === undefined) state = 'pending';
  }
  return state;
}

/** Stage 1 keys exist (the request was made), even if their values are still `undefined`. */
function hasCoreKeys(core: Record<string, unknown>): boolean {
  return 'structure' in core && 'workspaces' in core && 'status' in core;
}

function coreQueries(sessionId: string, chatroomId: string): RequestForQueries {
  const args = { sessionId, chatroomId: chatroomId as Id<'chatroom_rooms'> };
  return {
    structure: { query: api.chatrooms.getTeamStructureForChatroom, args },
    workspaces: { query: api.workspaces.listWorkspacesForChatroom, args },
    status: { query: api.agents.listStatus, args },
  };
}

function rolesOf(structure: NonNullable<TeamStructureResult>): string[] {
  return structure.roles.map(({ role }) => role.toLowerCase()).filter((role) => role !== 'user');
}

function machineIdsOf(workspaces: readonly WorkspaceRow[]): string[] {
  return [...new Set(workspaces.map((ws) => ws.machineId))];
}

function detailQueries(
  sessionId: string,
  chatroomId: string,
  structure: TeamStructureResult,
  workspaces: readonly WorkspaceRow[]
): RequestForQueries {
  if (!structure) return {};
  const roles = rolesOf(structure);
  const entries: [string, RequestForQueries[string]][] = [];
  for (const ws of workspaces) {
    entries.push([
      `requests:${ws._id}`,
      {
        query: api.agents.listLastSentLaunchRequests,
        args: {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          workspaceId: ws._id as Id<'chatroom_workspaces'>,
        },
      },
    ]);
  }
  for (const machineId of machineIdsOf(workspaces)) {
    entries.push([
      `caps:${machineId}`,
      { query: api.machines.getMachineCapabilities, args: { sessionId, machineId } },
    ]);
    for (const role of roles) {
      entries.push([
        `favs:${favoritesKey(machineId, role)}`,
        {
          query: api.machineConfigFavorites.getMachineConfigFavorites,
          args: {
            sessionId,
            machineId,
            teamRoleKey: buildMachineFavoriteScopeKey(structure.teamId, role),
          },
        },
      ]);
    }
  }
  return Object.fromEntries(entries);
}

function toStartCheckWorkspace(ws: WorkspaceRow): StartCheckWorkspace {
  return {
    id: ws._id,
    machineId: ws.machineId,
    workingDir: ws.workingDir,
    label: `${ws.machineAlias ?? ws.hostname}:${ws.workingDir}`,
  };
}

/** Builds the detector input from settled results and runs it. Call only when both stages are `ready`. */
function findMismatches(
  core: Record<string, any>,
  detail: Record<string, any>
): FavoriteMismatch[] {
  const structure = core.structure as TeamStructureResult;
  const workspaces = core.workspaces as WorkspaceRow[];
  const statuses = core.status as StatusRow[];
  const roles = structure ? rolesOf(structure) : [];
  const machineIds = machineIdsOf(workspaces);

  const requestsByWorkspace = new Map<string, StartCheckLaunchRequest[]>();
  for (const ws of workspaces) {
    requestsByWorkspace.set(
      ws._id,
      (detail[`requests:${ws._id}`] as StartCheckLaunchRequest[] | undefined) ?? []
    );
  }

  const favoritesByMachineRole = new Map<string, MachineConfigEntry[]>();
  const availableHarnessesByMachine = new Map<string, AgentHarness[]>();
  for (const machineId of machineIds) {
    availableHarnessesByMachine.set(
      machineId,
      (detail[`caps:${machineId}`] as CapabilitiesResult | undefined)?.availableHarnesses ?? []
    );
    for (const role of roles) {
      const key = favoritesKey(machineId, role);
      favoritesByMachineRole.set(
        key,
        (detail[`favs:${key}`] as FavoritesResult | undefined)?.favorites ?? []
      );
    }
  }

  return findFavoriteMismatches({
    roles,
    workspaces: workspaces.map(toStartCheckWorkspace),
    requestsByWorkspace,
    favoritesByMachineRole,
    availableHarnessesByMachine,
    runningRoles: new Set(
      statuses.filter((row) => row.isRunning).map((row) => row.role.toLowerCase())
    ),
  });
}

type CheckResult =
  { status: 'pending' } | { status: 'error' } | { status: 'ready'; mismatches: FavoriteMismatch[] };

function readCheck(core: Record<string, unknown>, detail: Record<string, unknown>): CheckResult {
  if (!hasCoreKeys(core)) return { status: 'pending' };
  const coreState = settle(core);
  if (coreState === 'error') return { status: 'error' };
  if (coreState === 'pending') return { status: 'pending' };
  const detailState = settle(detail);
  if (detailState === 'error') return { status: 'error' };
  if (detailState === 'pending') return { status: 'pending' };
  return { status: 'ready', mismatches: findMismatches(core, detail) };
}

function toApplyItem(chatroomId: string, mismatch: FavoriteMismatch): ApplyFavoriteConfigItem {
  return {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    workspaceId: mismatch.workspaceId as Id<'chatroom_workspaces'>,
    machineId: mismatch.machineId,
    workingDir: mismatch.workingDir,
    role: mismatch.role,
    entry: mismatch.favorite,
  };
}

// ── Controller ──────────────────────────────────────────────────────────────
export function useStartAgentsWithFavorites({
  chatroomId,
  start,
}: UseStartAgentsWithFavoritesOptions): UseStartAgentsWithFavoritesResult {
  const [sessionId] = useSessionId();
  const saveConfig = useSessionMutation(api.agents.saveConfig);

  const [phase, setPhase] = useState<StartFlowPhase>('idle');
  // Mirrors `phase` synchronously so a second click or a stale timer cannot start a second flow.
  const phaseRef = useRef<StartFlowPhase>('idle');
  const [mismatches, setMismatches] = useState<readonly FavoriteMismatch[]>([]);
  const [failures, setFailures] = useState<readonly StartFavoriteFailure[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  const [startedFromDialog, setStartedFromDialog] = useState(false);
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const moveTo = useCallback((next: StartFlowPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const finish = useCallback(
    async (count: number, fromDialog: boolean) => {
      setStartedFromDialog(fromDialog);
      moveTo('starting');
      try {
        await startRef.current({ appliedCount: count });
      } finally {
        setStartedFromDialog(false);
        moveTo('idle');
      }
    },
    [moveTo]
  );

  // Subscriptions exist only while a flow is active; idle passes `{}`.
  const active = phase !== 'idle' && Boolean(sessionId);
  const core = useQueries(active && sessionId ? coreQueries(sessionId, chatroomId) : {});
  const coreReady = active && hasCoreKeys(core) && settle(core) === 'ready';
  const detail = useQueries(
    coreReady && sessionId
      ? detailQueries(sessionId, chatroomId, core.structure, core.workspaces)
      : {}
  );

  const check = phase === 'checking' ? readCheck(core, detail) : null;

  useEffect(() => {
    if (phaseRef.current !== 'checking' || check === null || check.status === 'pending') return;
    if (check.status === 'error') {
      console.warn('Start-all favourite check failed; starting with the current configuration.');
      void finish(0, false);
      return;
    }
    if (check.mismatches.length === 0) {
      void finish(0, false);
      return;
    }
    setMismatches(check.mismatches);
    moveTo('prompt');
  }, [check, finish, moveTo]);

  useEffect(() => {
    if (phase !== 'checking') return;
    const timer = setTimeout(() => {
      if (phaseRef.current !== 'checking') return;
      console.warn(
        `Start-all favourite check timed out after ${START_FAVORITES_CHECK_TIMEOUT_MS}ms; starting with the current configuration.`
      );
      void finish(0, false);
    }, START_FAVORITES_CHECK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, finish]);

  const requestStart = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    moveTo('checking');
  }, [moveTo]);

  const confirmFavourites = useCallback(async () => {
    if (phaseRef.current !== 'prompt') return;
    moveTo('applying');
    const outcomes = await Promise.all(
      mismatches.map(async (mismatch) => ({
        mismatch,
        result: await applyFavoriteConfigs(saveConfig, [toApplyItem(chatroomId, mismatch)]),
      }))
    );
    const applied = outcomes.reduce((count, { result }) => count + result.applied.length, 0);
    const failed = outcomes.flatMap(({ mismatch, result }) =>
      result.failed.map((failure) => ({
        role: failure.role,
        workspaceLabel: mismatch.workspaceLabel,
        message: failure.message,
      }))
    );
    if (failed.length === 0) {
      await finish(applied, true);
      return;
    }
    setAppliedCount(applied);
    setFailures(failed);
    moveTo('apply-error');
  }, [chatroomId, finish, mismatches, moveTo, saveConfig]);

  const startWithCurrent = useCallback(() => {
    if (phaseRef.current !== 'prompt') return;
    void finish(0, true);
  }, [finish]);

  const startAnyway = useCallback(() => {
    if (phaseRef.current !== 'apply-error') return;
    void finish(appliedCount, true);
  }, [appliedCount, finish]);

  const cancel = useCallback(() => {
    if (phaseRef.current !== 'prompt' && phaseRef.current !== 'apply-error') return;
    moveTo('idle');
  }, [moveTo]);

  const dialogOpen =
    phase === 'prompt' ||
    phase === 'applying' ||
    phase === 'apply-error' ||
    (phase === 'starting' && startedFromDialog);

  return {
    phase,
    isBusy: phase === 'checking' || phase === 'applying' || phase === 'starting',
    requestStart,
    dialogProps: {
      open: dialogOpen,
      phase,
      mismatches,
      failures,
      showWorkspaceLabels: new Set(mismatches.map((m) => m.workspaceId)).size > 1,
      onUseFavourites: () => void confirmFavourites(),
      onStartWithCurrent: startWithCurrent,
      onStartAnyway: startAnyway,
      onCancel: cancel,
    },
  };
}
