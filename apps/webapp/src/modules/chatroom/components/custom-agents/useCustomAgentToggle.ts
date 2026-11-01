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
 * - `idle` once the roster confirms either state, when the agent disappears
 *   for any reason other than the cap, or when a cap copy's row returns to the
 *   roster (whatever its `disabled` flag says).
 *
 * Every `over-limit` name carries a failure, including agents the user never
 * toggled: enabling one agent can push a different, already-enabled agent past
 * the cap, and that displaced agent must stay visible in the tab too.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CUSTOM_AGENT_DISPLACED_MESSAGE,
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
  /**
   * Names the source issues mark `over-limit`. Every one of them reports a
   * failure while it persists: the toggled agent with the enable copy, any agent
   * this enable pushed out with the displaced copy.
   */
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

/**
 * The state an agent the user never toggled settles on when the cap cuts it. The
 * copy is the displaced wording: this enable was not its request, but the agent
 * still joins by itself once a slot frees. A single frozen value lets
 * `resolveMissingRow` keep it by identity across every later roster push.
 */
const DISPLACED_FAILURE: CustomAgentToggleState = {
  kind: 'failed',
  desiredDisabled: false,
  message: CUSTOM_AGENT_DISPLACED_MESSAGE,
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
  // and every name the cap cuts settles on a visible failure — the toggled agent
  // with the enable copy, an agent this enable pushed out with the displaced copy.
  // The roster is server truth; this local map only records intent until it agrees,
  // so it is neither derived render state nor an event-handler side effect.
  /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-derived-state */
  useEffect(() => {
    const { states: next, reset, changed } = reconcile(statesRef.current, rows, overLimitNames);
    if (!changed) return;
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
): { states: ToggleStates; reset: string[]; changed: boolean } {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const { next, reset } = resolveTracked(states, byName, overLimitNames);
  // The cap can cut an agent this user never toggled, so no intent exists for it
  // yet: every unresolved over-limit name gets the frozen displaced failure, which
  // keeps it visible on the source issue that names it.
  for (const name of overLimitNames) next[name] ??= DISPLACED_FAILURE;
  return { states: next, reset, changed: !isSameStates(states, next) };
}

/** The next state of each tracked name; `reset` lists the names whose timer must stop. */
function resolveTracked(
  states: ToggleStates,
  byName: ReadonlyMap<string, CustomAgentRowModel>,
  overLimitNames: ReadonlySet<string>
): { next: ToggleStates; reset: string[] } {
  const next: ToggleStates = {};
  const reset: string[] = [];
  for (const [name, state] of Object.entries(states)) {
    const resolution = resolveState(state, byName.get(name), overLimitNames.has(name));
    if (resolution.reset) reset.push(name);
    if (resolution.state !== null) next[name] = resolution.state;
  }
  return { next, reset };
}

/** Identity comparison is enough: every entry is one of a few frozen objects or a state object. */
function isSameStates(left: ToggleStates, right: ToggleStates): boolean {
  const names = Object.keys(left);
  if (names.length !== Object.keys(right).length) return false;
  return names.every((name) => left[name] === right[name]);
}

function resolveState(
  state: CustomAgentToggleState,
  row: CustomAgentRowModel | undefined,
  overLimit: boolean
): { state: CustomAgentToggleState | null; reset: boolean } {
  if (row === undefined) return resolveMissingRow(state, overLimit);
  if (state.kind === 'idle') return { state, reset: false };
  if (isSettledByRow(state, row)) return { state: IDLE, reset: true };
  return { state, reset: false };
}

/**
 * A present row settles the intent: it either confirms it, or disproves a stored
 * over-limit copy. The cap no longer cuts this agent, so that copy is stale
 * whatever the row's disabled flag now says. Other failures stay until the row
 * confirms them: only the two frozen cap copies clear here.
 */
function isSettledByRow(
  state: Exclude<CustomAgentToggleState, { kind: 'idle' }>,
  row: CustomAgentRowModel
): boolean {
  return isCapCopy(state) || row.disabled === state.desiredDisabled;
}

/** True for the two frozen copies the cap produced while the agent had no row. */
function isCapCopy(state: CustomAgentToggleState): boolean {
  return state === DISPLACED_FAILURE || state === OVER_LIMIT_FAILURE;
}

/**
 * `mergeTeamStructureWithCustomAgents` removes an enabled agent past the
 * per-chatroom cap from the roster, so enabling one is the only way a tracked
 * name loses its row. Two names can land here:
 *
 * - an agent this user toggled on — it settles on the enable failure while the
 *   source still reports `over-limit`, and drops once the issue clears or the
 *   user aimed for off;
 * - an already-enabled agent the enable displaced — `reconcile` seeded it with
 *   the frozen displaced failure, which must survive every later roster push.
 *   It was never toggled, so claiming it was turned on would be wrong.
 */
function resolveMissingRow(
  state: CustomAgentToggleState,
  overLimit: boolean
): { state: CustomAgentToggleState | null; reset: boolean } {
  if (!overLimit || !isEnableIntent(state)) return { state: null, reset: true };
  // The displaced failure was set by reconcile for a name the user never toggled.
  // It stays as it is; only a pending or failed enable becomes the over-limit copy.
  if (state === DISPLACED_FAILURE) return { state, reset: false };
  // A reset name clears the pending timer and commits; an entry that is already
  // the frozen failure is left untouched, so repeated reconciles are no-ops.
  return { state: OVER_LIMIT_FAILURE, reset: state !== OVER_LIMIT_FAILURE };
}

/** True while the tracked state still aims to turn the agent on. */
function isEnableIntent(state: CustomAgentToggleState): boolean {
  return state.kind !== 'idle' && !state.desiredDisabled;
}
