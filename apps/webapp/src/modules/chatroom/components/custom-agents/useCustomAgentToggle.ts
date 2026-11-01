/**
 * Per-agent disable intent for the Custom Agents tab.
 *
 * The hook never changes a row's displayed state: a toggle records intent only,
 * and the row is confirmed solely by the next roster. That keeps the daemon as
 * the single writer and stops the UI from claiming a change the machine has not
 * pushed yet.
 *
 * Lifecycle of one toggle:
 * - `pending` while waiting for the machine command to be accepted and the
 *   roster to come back with the desired value;
 * - `failed` when the mutation rejects or the 10 s timeout fires first, and when
 *   the per-chatroom cap dropped the enabled agent from the roster entirely;
 * - `idle` once the roster confirms either state, or when the agent disappears
 *   for any reason other than the cap.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
  CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
  customAgentMutationErrorMessage,
} from './customAgentCopy';
import type { CustomAgentRowModel } from './customAgentsViewModel';

const CUSTOM_AGENT_TOGGLE_TIMEOUT_MS = 10_000;

export type CustomAgentToggleState =
  | { kind: 'idle' }
  | { kind: 'pending'; desiredDisabled: boolean; requestId: number }
  | { kind: 'failed'; desiredDisabled: boolean; message: string };

type ToggleStates = Record<string, CustomAgentToggleState>;

export interface UseCustomAgentToggleArgs {
  chatroomId: string;
  rows: readonly CustomAgentRowModel[];
  /** Names the source issues mark `over-limit`; an enable for one of these stays failed while it persists. */
  overLimitNames?: ReadonlySet<string>;
}

export interface UseCustomAgentToggleResult {
  stateFor: (name: string) => CustomAgentToggleState;
  requestToggle: (name: string, desiredDisabled: boolean) => void;
}

const IDLE: CustomAgentToggleState = { kind: 'idle' };

const NO_OVER_LIMIT: ReadonlySet<string> = new Set();

/**
 * The state an over-limit enable settles on. A single frozen value keeps
 * `resolveState` identity-stable, so a reconcile with nothing new to report does
 * not commit a fresh map.
 */
const OVER_LIMIT_FAILURE: CustomAgentToggleState = {
  kind: 'failed',
  desiredDisabled: false,
  message: CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
};

export function useCustomAgentToggle({
  chatroomId,
  rows,
  overLimitNames = NO_OVER_LIMIT,
}: UseCustomAgentToggleArgs): UseCustomAgentToggleResult {
  const setDisabled = useSessionMutation(api.customAgents.setDisabled);
  const [states, setStates] = useState<ToggleStates>({});
  /** Latest states for async callbacks; the hook keeps it in sync with `commit`. */
  const statesRef = useRef<ToggleStates>(states);
  const timers = useRef<Map<string, number>>(new Map());
  const sequence = useRef(0);

  const commit = useCallback((next: ToggleStates) => {
    statesRef.current = next;
    setStates(next);
  }, []);

  const setState = useCallback(
    (name: string, next: CustomAgentToggleState) => {
      commit({ ...statesRef.current, [name]: next });
    },
    [commit]
  );

  const clearTimer = useCallback((name: string) => {
    const handle = timers.current.get(name);
    if (handle === undefined) return;
    window.clearTimeout(handle);
    timers.current.delete(name);
  }, []);

  /** Marks a pending request failed when it is still the current one. */
  const failPending = useCallback(
    (name: string, requestId: number, message: string) => {
      const current = statesRef.current[name];
      if (current?.kind !== 'pending' || current.requestId !== requestId) return;
      clearTimer(name);
      setState(name, { kind: 'failed', desiredDisabled: current.desiredDisabled, message });
    },
    [clearTimer, setState]
  );

  const startTimer = useCallback(
    (name: string, requestId: number) => {
      clearTimer(name);
      const handle = window.setTimeout(() => {
        timers.current.delete(name);
        failPending(name, requestId, CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE);
      }, CUSTOM_AGENT_TOGGLE_TIMEOUT_MS);
      timers.current.set(name, handle);
    },
    [clearTimer, failPending]
  );

  const requestToggle = useCallback(
    (name: string, desiredDisabled: boolean) => {
      if (statesRef.current[name]?.kind === 'pending') return;
      sequence.current += 1;
      const requestId = sequence.current;
      setState(name, { kind: 'pending', desiredDisabled, requestId });
      startTimer(name, requestId);
      void Promise.resolve(
        setDisabled({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          name,
          disabled: desiredDisabled,
        })
      ).catch((error: unknown) => {
        failPending(name, requestId, customAgentMutationErrorMessage(error));
      });
    },
    [chatroomId, failPending, setDisabled, setState, startTimer]
  );

  // Reconcile against the roster: confirmations clear intent, removals drop it,
  // and an enable the cap rejected settles on the visible over-limit failure.
  // The roster is server truth; this local map only records intent until it agrees,
  // so it is neither derived render state nor an event-handler side effect.
  /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-derived-state */
  useEffect(() => {
    const { states: next, reset } = reconcile(statesRef.current, rows, overLimitNames);
    if (reset.length === 0) return;
    for (const name of reset) clearTimer(name);
    commit(next);
  }, [rows, overLimitNames, clearTimer, commit]);
  /* eslint-enable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-derived-state */

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const handle of pending.values()) window.clearTimeout(handle);
      pending.clear();
    };
  }, []);

  const stateFor = useCallback((name: string) => states[name] ?? IDLE, [states]);

  return { stateFor, requestToggle };
}

/** Applies roster truth to every tracked name. Returns the next map and the reset names. */
function reconcile(
  states: ToggleStates,
  rows: readonly CustomAgentRowModel[],
  overLimitNames: ReadonlySet<string>
): { states: ToggleStates; reset: string[] } {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const next: ToggleStates = {};
  const reset: string[] = [];

  for (const [name, state] of Object.entries(states)) {
    const resolution = resolveState(state, byName.get(name), overLimitNames.has(name));
    if (resolution.reset) reset.push(name);
    if (resolution.state !== null) next[name] = resolution.state;
  }
  return { states: next, reset };
}

function resolveState(
  state: CustomAgentToggleState,
  row: CustomAgentRowModel | undefined,
  overLimit: boolean
): { state: CustomAgentToggleState | null; reset: boolean } {
  if (row === undefined) return resolveMissingRow(state, overLimit);
  if (state.kind === 'idle') return { state, reset: false };
  if (row.disabled === state.desiredDisabled) return { state: IDLE, reset: true };
  return { state, reset: false };
}

/**
 * `mergeTeamStructureWithCustomAgents` removes an enabled agent past the
 * per-chatroom cap from the roster, so enabling one is the only way a tracked
 * name loses its row. Keep the failure while the source still reports
 * `over-limit`; drop it once the issue clears or the user aimed for off.
 */
function resolveMissingRow(
  state: CustomAgentToggleState,
  overLimit: boolean
): { state: CustomAgentToggleState | null; reset: boolean } {
  if (!overLimit || state.kind === 'idle' || state.desiredDisabled) {
    return { state: null, reset: true };
  }
  // A reset name clears the pending timer and commits; an entry that is already
  // the frozen failure is left untouched, so repeated reconciles are no-ops.
  return { state: OVER_LIMIT_FAILURE, reset: state !== OVER_LIMIT_FAILURE };
}
