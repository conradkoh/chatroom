export type { ResumePath } from './entities/resume-path.js';
export type { HarnessSessionSnapshot } from './entities/session-snapshot.js';
export type { StopReason } from './entities/stop-reason.js';
export { resolveStopReason } from './entities/stop-reason.js';
export {
  shouldRetainHarnessSessionForReconnect,
  shouldPreserveHarnessTeardown,
} from './policies/preserve-session.js';
export {
  decideResumePathOnRestart,
  shouldAutoRestartAfterProcessExit,
  resumePathAfterTurnCompleted,
} from './policies/decide-resume-path.js';

// Phase 1: Pure domain state machine + invariants
export type { AgentSlotState, AgentSlotSnapshot } from './entities/agent-slot.js';
export { idleSlot, agentKey } from './entities/agent-slot.js';
export type {
  SlotTransitionEvent,
  SlotTransitionResult,
  SlotTransitionError,
} from './policies/slot-transitions.js';
export { transitionSlot, shouldIgnoreProcessExit } from './policies/slot-transitions.js';
export type { RestartOutcome } from './policies/restart-decision.js';
export { decideRestartAfterExit } from './policies/restart-decision.js';
