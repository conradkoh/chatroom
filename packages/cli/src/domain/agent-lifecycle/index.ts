// fallow-ignore-file unused-export

export type { ResumePath } from '../../v2/domain/entities/resume-path.js';
export type { HarnessSessionSnapshot } from '../../v2/domain/entities/session-snapshot.js';
export { resolveResumableHarnessSessionId } from '../../v2/domain/entities/harness-session-id-pair.js';
export type { StopReason } from '../../v2/domain/entities/stop-reason.js';
export { resolveStopReason } from '../../v2/domain/entities/stop-reason.js';
export {
  shouldRetainHarnessSessionForReconnect,
  shouldPreserveHarnessTeardown,
} from '../../v2/domain/usecase/preserve-harness-session.js';
export {
  decideResumePathOnRestart,
  shouldAutoRestartAfterProcessExit,
} from '../../v2/domain/usecase/decide-resume-path.js';

// Phase 1: Pure domain state machine + invariants
export type { AgentSlotState, AgentSlotSnapshot } from '../../v2/domain/entities/agent-slot.js';
export { idleSlot, agentKey } from '../../v2/domain/entities/agent-slot.js';
export type {
  SlotTransitionEvent,
  SlotTransitionResult,
  SlotTransitionError,
} from '../../v2/domain/usecase/transition-agent-slot.js';
export {
  transitionSlot,
  shouldIgnoreProcessExit,
} from '../../v2/domain/usecase/transition-agent-slot.js';
export type { RestartOutcome } from '../../v2/domain/usecase/decide-restart-after-exit.js';
export { decideRestartAfterExit } from '../../v2/domain/usecase/decide-restart-after-exit.js';
export {
  isSlotIdle,
  isSlotRunning,
  isSlotSpawning,
  isSlotStopping,
  isTurnPhaseIdle,
} from './predicates/agent-slot.js';
