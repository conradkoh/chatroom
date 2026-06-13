import type { AgentSlotSnapshot, AgentSlotState } from '../entities/agent-slot.js';

export type SlotTransitionError =
  | { readonly _tag: 'InvalidTransition'; readonly from: AgentSlotState; readonly event: string }
  | { readonly _tag: 'StalePid'; readonly expected: number; readonly got: number }
  | { readonly _tag: 'IgnoredDuplicateExit' };

export type SlotTransitionEvent =
  | { readonly type: 'ensure_running_requested' }
  | { readonly type: 'spawn_started'; readonly operationKey: string }
  | { readonly type: 'spawn_succeeded'; readonly pid: number }
  | { readonly type: 'spawn_failed' }
  | { readonly type: 'stop_requested'; readonly operationKey: string }
  | { readonly type: 'stop_completed' }
  | { readonly type: 'process_exited'; readonly pid: number }
  | { readonly type: 'stale_process_detected' };

export type SlotTransitionResult =
  | { readonly ok: true; readonly slot: AgentSlotSnapshot }
  | { readonly ok: false; readonly error: SlotTransitionError };

function makeError(tag: string, from: AgentSlotState, event: string): SlotTransitionResult {
  return {
    ok: false,
    error: { _tag: tag as any, from, event },
  };
}

function makeResult(slot: AgentSlotSnapshot): SlotTransitionResult {
  return { ok: true, slot };
}

/**
 * Pure state machine transition — mirrors APM guards without I/O.
 */
export function transitionSlot(
  slot: AgentSlotSnapshot,
  event: SlotTransitionEvent
): SlotTransitionResult {
  const state = slot.state;

  switch (state) {
    case 'idle': {
      if (event.type === 'ensure_running_requested') {
        // Stays idle — spawn happens in outer layer
        return makeResult(slot);
      }
      if (event.type === 'spawn_started') {
        return makeResult({ ...slot, state: 'spawning', pendingOperationKey: event.operationKey });
      }
      if (event.type === 'process_exited') {
        // Exiting an idle slot with no pid is a no-op (ignore via successful transition)
        return makeResult(slot);
      }
      return makeError('InvalidTransition', state, event.type);
    }

    case 'spawning': {
      if (event.type === 'spawn_started') {
        return makeResult({ ...slot, pendingOperationKey: event.operationKey });
      }
      if (event.type === 'spawn_succeeded') {
        return makeResult({ ...slot, state: 'running', pid: event.pid });
      }
      if (event.type === 'spawn_failed') {
        return makeResult({ state: 'idle' });
      }
      if (event.type === 'process_exited') {
        // Process exited during spawning — treat as failed
        return makeResult({ state: 'idle' });
      }
      return makeError('InvalidTransition', state, event.type);
    }

    case 'running': {
      if (event.type === 'stop_requested') {
        return makeResult({ ...slot, state: 'stopping', pendingOperationKey: event.operationKey });
      }
      if (event.type === 'process_exited') {
        // shouldIgnoreProcessExit catches stopping state before we reach here
        if (slot.pid !== undefined && slot.pid !== event.pid) {
          return { ok: false, error: { _tag: 'StalePid', expected: slot.pid, got: event.pid } };
        }
        return makeResult({ state: 'idle' });
      }
      if (event.type === 'stale_process_detected') {
        return makeResult({ state: 'idle' });
      }
      return makeError('InvalidTransition', state, event.type);
    }

    case 'stopping': {
      if (event.type === 'stop_completed') {
        return makeResult({ state: 'idle' });
      }
      if (event.type === 'process_exited') {
        // When stopping, process exit is ignored — doStop owns teardown
        return { ok: false, error: { _tag: 'IgnoredDuplicateExit' } };
      }
      return makeError('InvalidTransition', state, event.type);
    }
  }
}

/**
 * When handleExit sees state==='stopping', doStop owns lifecycle — exit is ignored.
 */
export function shouldIgnoreProcessExit(slot: AgentSlotSnapshot, exitPid: number): boolean {
  if (slot.state === 'stopping') return true;
  // Not stopping — ignore exits with mismatched pids (stale process)
  if (slot.pid !== undefined && slot.pid !== exitPid) return true;
  return false;
}
