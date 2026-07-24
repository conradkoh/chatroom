// fallow-ignore-file unused-file
/**
 * ChatroomEvent — union type for all events in the chatroom_eventStream table.
 *
 * Each variant carries full state — consumers never need to fetch additional data
 * after receiving an event.
 */

import type { AgentHarness } from './agent';
import type { Id } from '../../../convex/_generated/dataModel';

export type AgentStartedEvent = {
  type: 'agent.started';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  pid: number;
  reason?: string;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentExitedEvent = {
  type: 'agent.exited';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid: number;
  intentional?: boolean;
  stopReason?: string;
  stopSignal?: string;
  exitCode?: number;
  signal?: string;
  timestamp: number;
};

export type TaskActivatedEvent = {
  type: 'task.activated';
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  role: string;
  taskStatus: string;
  taskContent: string;
  timestamp: number;
};

export type TaskCompletedEvent = {
  type: 'task.completed';
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  role: string;
  finalStatus: string;
  timestamp: number;
};

export type AgentRequestStartEvent = {
  type: 'agent.requestStart';
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  timestamp: number;
  wantResume?: boolean;
  /** @deprecated Legacy snapshot — no longer written. Kept optional for historical events. */
  autoRestartOnNewContext?: boolean;
};

export type AgentRequestStopEvent = {
  type: 'agent.requestStop';
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  reason: string;
  deadline: number;
  timestamp: number;
};

export type AgentRegisteredEvent = {
  type: 'agent.registered';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentType: 'custom' | 'remote';
  machineId?: string;
  timestamp: number;
};

export type MachineSwitchedEvent = {
  type: 'machine.switched';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  previousMachineId: string;
  newMachineId: string;
  reason: string;
  timestamp: number;
};

export type AgentCircuitOpenEvent = {
  type: 'agent.circuitOpen';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  reason: string;
  timestamp: number;
};

export type AgentWaitingEvent = {
  type: 'agent.waiting';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId?: string;
  timestamp: number;
};

export type AgentStartFailedEvent = {
  type: 'agent.startFailed';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  error: string;
  timestamp: number;
};

export type AgentSessionResumeRequestedEvent = {
  type: 'agent.sessionResumeRequested';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  agentHarness: AgentHarness;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentSessionResumedEvent = {
  type: 'agent.sessionResumed';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentSessionResumeFailedEvent = {
  type: 'agent.sessionResumeFailed';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  reason: string;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentSessionReopenRetryEvent = {
  type: 'agent.sessionReopenRetry';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  attempt: number;
  maxAttempts: number;
  error?: string;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentSessionCompactedEvent = {
  type: 'agent.sessionCompacted';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  taskId: Id<'chatroom_tasks'>;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentSessionAugmentedEvent = {
  type: 'agent.sessionAugmented';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  taskId: Id<'chatroom_tasks'>;
  mode: 'none' | 'compact' | 'new_session';
  newSessionStarted: boolean;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentResumeStormAbortedEvent = {
  type: 'agent.resumeStormAborted';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  reason: 'unknown' | 'auth_error' | 'rate_limit' | 'config_error';
  endCount: number;
  windowMs: number;
  harnessSessionId?: string;
  timestamp: number;
};

export type AgentRestartLimitReachedEvent = {
  type: 'agent.restartLimitReached';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  restartCount: number;
  windowMs: number;
  timestamp: number;
};

export type AgentStopTimeoutEvent = {
  type: 'agent.stopTimeout';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid?: number;
  durationMs: number;
  timestamp: number;
};

export type AgentAwaitingHandoffEvent = {
  type: 'agent.awaitingHandoff';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  timestamp: number;
};

export type TaskAcknowledgedEvent = {
  type: 'task.acknowledged';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
  timestamp: number;
};

export type TaskInProgressEvent = {
  type: 'task.inProgress';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
  timestamp: number;
};

export type DaemonPingEvent = {
  type: 'daemon.ping';
  machineId: string;
  timestamp: number;
};

export type DaemonPongEvent = {
  type: 'daemon.pong';
  machineId: string;
  pingEventId: Id<'chatroom_eventStream'>;
  timestamp: number;
};

export type SkillActivatedEvent = {
  type: 'skill.activated';
  chatroomId: Id<'chatroom_rooms'>;
  skillId: string;
  skillName: string;
  role: string;
  prompt: string;
  timestamp: number;
};

export type EnhancerJobCreatedEvent = {
  type: 'enhancer.job.created';
  chatroomId: Id<'chatroom_rooms'>;
  jobId: Id<'chatroom_enhancerJobs'>;
  userId: Id<'users'>;
  attemptCount: number;
  maxAttempts: number;
  timestamp: number;
};

export type EnhancerAttemptFailedEvent = {
  type: 'enhancer.attempt.failed';
  chatroomId: Id<'chatroom_rooms'>;
  jobId: Id<'chatroom_enhancerJobs'>;
  attemptCount: number;
  error: string;
  nextRetryAt?: number;
  timestamp: number;
};

export type EnhancerJobFailedEvent = {
  type: 'enhancer.job.failed';
  chatroomId: Id<'chatroom_rooms'>;
  jobId: Id<'chatroom_enhancerJobs'>;
  attemptCount: number;
  error: string;
  timestamp: number;
};

export type EnhancerJobCompleteEvent = {
  type: 'enhancer.job.complete';
  chatroomId: Id<'chatroom_rooms'>;
  jobId: Id<'chatroom_enhancerJobs'>;
  attemptCount: number;
  timestamp: number;
};

export type EnhancerJobCancelledEvent = {
  type: 'enhancer.job.cancelled';
  chatroomId: Id<'chatroom_rooms'>;
  jobId: Id<'chatroom_enhancerJobs'>;
  attemptCount: number;
  timestamp: number;
};

export type ChatroomEvent =
  | AgentStartedEvent
  | AgentExitedEvent
  | AgentCircuitOpenEvent
  | TaskActivatedEvent
  | TaskCompletedEvent
  | AgentRequestStartEvent
  | AgentRequestStopEvent
  | AgentRegisteredEvent
  | MachineSwitchedEvent
  | AgentWaitingEvent
  | TaskAcknowledgedEvent
  | TaskInProgressEvent
  | DaemonPingEvent
  | DaemonPongEvent
  | SkillActivatedEvent
  | AgentStartFailedEvent
  | AgentSessionResumeRequestedEvent
  | AgentSessionResumedEvent
  | AgentSessionResumeFailedEvent
  | AgentSessionReopenRetryEvent
  | AgentSessionCompactedEvent
  | AgentSessionAugmentedEvent
  | AgentRestartLimitReachedEvent
  | AgentStopTimeoutEvent
  | AgentAwaitingHandoffEvent
  | EnhancerJobCreatedEvent
  | EnhancerAttemptFailedEvent
  | EnhancerJobFailedEvent
  | EnhancerJobCompleteEvent
  | EnhancerJobCancelledEvent;
