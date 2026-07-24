/**
 * Domain Entity: EventStreamEvent
 *
 * Canonical shapes for chatroom event stream entries in the frontend.
 * Each variant's `type` field aligns with `EventTypeName` in `event-type.ts`.
 *
 * Convex persistence fields (`_id`, `_creationTime`) are included because
 * consumers read hydrated documents from queries.
 */

// ─── Base Event Interface ─────────────────────────────────────────────────────

/**
 * Base shape for a single chatroom event stream entry.
 * Both `timestamp` and `_creationTime` are present — EventRow uses
 * `event.timestamp ?? event._creationTime` as the display time.
 */
export interface EventStreamEventBase {
  _id: string;
  _creationTime: number;
  timestamp: number;
}

// ─── Agent Event Types ────────────────────────────────────────────────────────

export interface AgentStartedEvent extends EventStreamEventBase {
  type: 'agent.started';
  role: string;
  machineId: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  pid: number;
  reason?: string;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentExitedEvent extends EventStreamEventBase {
  type: 'agent.exited';
  role: string;
  machineId: string;
  pid: number;
  intentional?: boolean;
  stopReason?: string;
  stopSignal?: string;
  exitCode?: number;
  signal?: string;
  chatroomId: string;
}

export interface AgentCircuitOpenEvent extends EventStreamEventBase {
  type: 'agent.circuitOpen';
  role: string;
  machineId: string;
  reason: string;
  chatroomId: string;
}

export interface AgentRequestStartEvent extends EventStreamEventBase {
  type: 'agent.requestStart';
  role: string;
  machineId: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  chatroomId: string;
  /** When true (default), resume from the daemon's last session on first launch. */
  wantResume?: boolean;
  /** @deprecated Legacy snapshot — no longer written. Kept optional for historical events. */
  autoRestartOnNewContext?: boolean;
}

export interface AgentRequestStopEvent extends EventStreamEventBase {
  type: 'agent.requestStop';
  role: string;
  machineId: string;
  reason: string;
  deadline: number;
  chatroomId: string;
}

export interface AgentRegisteredEvent extends EventStreamEventBase {
  type: 'agent.registered';
  role: string;
  agentType: string;
  machineId?: string;
  chatroomId: string;
}

export interface AgentWaitingEvent extends EventStreamEventBase {
  type: 'agent.waiting';
  role: string;
  machineId?: string;
  chatroomId: string;
}

export interface AgentStartFailedEvent extends EventStreamEventBase {
  type: 'agent.startFailed';
  role: string;
  machineId: string;
  error: string;
  chatroomId: string;
}

export interface AgentSessionResumeRequestedEvent extends EventStreamEventBase {
  type: 'agent.sessionResumeRequested';
  role: string;
  machineId: string;
  agentHarness: string;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentSessionResumedEvent extends EventStreamEventBase {
  type: 'agent.sessionResumed';
  role: string;
  machineId: string;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentSessionResumeFailedEvent extends EventStreamEventBase {
  type: 'agent.sessionResumeFailed';
  role: string;
  machineId: string;
  reason: string;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentSessionReopenRetryEvent extends EventStreamEventBase {
  type: 'agent.sessionReopenRetry';
  role: string;
  machineId: string;
  attempt: number;
  maxAttempts: number;
  error?: string;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentSessionCompactedEvent extends EventStreamEventBase {
  type: 'agent.sessionCompacted';
  role: string;
  machineId: string;
  taskId: string;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentSessionAugmentedEvent extends EventStreamEventBase {
  type: 'agent.sessionAugmented';
  role: string;
  machineId: string;
  taskId: string;
  mode: 'none' | 'compact' | 'new_session';
  newSessionStarted: boolean;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentResumeStormAbortedEvent extends EventStreamEventBase {
  type: 'agent.resumeStormAborted';
  role: string;
  machineId: string;
  reason: 'unknown' | 'auth_error' | 'rate_limit' | 'config_error';
  endCount: number;
  windowMs: number;
  harnessSessionId?: string;
  chatroomId: string;
}

export interface AgentRestartLimitReachedEvent extends EventStreamEventBase {
  type: 'agent.restartLimitReached';
  role: string;
  machineId: string;
  restartCount: number;
  windowMs: number;
  chatroomId: string;
}

export interface AgentStopTimeoutEvent extends EventStreamEventBase {
  type: 'agent.stopTimeout';
  role: string;
  machineId: string;
  pid?: number;
  durationMs: number;
  chatroomId: string;
}

export interface AgentHarnessSessionIdUpdatedEvent extends EventStreamEventBase {
  type: 'agent.harnessSessionIdUpdated';
  role: string;
  machineId: string;
  correlationId: string;
  previousResumableId?: string;
  resumableId: string;
  source: 'provider_allocated' | 'provider_rotated';
  chatroomId: string;
}

export interface AgentAwaitingHandoffEvent extends EventStreamEventBase {
  type: 'agent.awaitingHandoff';
  role: string;
  chatroomId: string;
}

export interface AgentTaskDeliveredEvent extends EventStreamEventBase {
  type: 'agent.taskDelivered';
  chatroomId: string;
  machineId: string;
  role: string;
  taskId: string;
}

export interface AgentTaskDeliveryFailedEvent extends EventStreamEventBase {
  type: 'agent.taskDeliveryFailed';
  chatroomId: string;
  machineId: string;
  role: string;
  taskId?: string;
  error: string;
}

export interface MachineSwitchedEvent extends EventStreamEventBase {
  type: 'machine.switched';
  role: string;
  previousMachineId: string;
  newMachineId: string;
  reason: string;
  chatroomId: string;
}

// ─── Task Event Types ────────────────────────────────────────────────────────

export interface TaskActivatedEvent extends EventStreamEventBase {
  type: 'task.activated';
  role: string;
  taskId: string;
  taskStatus: string;
  taskContent: string;
  machineId?: string;
  chatroomId: string;
}

export interface TaskAcknowledgedEvent extends EventStreamEventBase {
  type: 'task.acknowledged';
  role: string;
  taskId: string;
  chatroomId: string;
}

export interface TaskInProgressEvent extends EventStreamEventBase {
  type: 'task.inProgress';
  role: string;
  taskId: string;
  chatroomId: string;
}

export interface TaskCompletedEvent extends EventStreamEventBase {
  type: 'task.completed';
  role: string;
  taskId: string;
  finalStatus: string;
  machineId?: string;
  skipAgentStatusUpdate?: boolean;
  chatroomId: string;
}

// ─── Skill Event Types ───────────────────────────────────────────────────────

export interface SkillActivatedEvent extends EventStreamEventBase {
  type: 'skill.activated';
  role: string;
  skillId: string;
  skillName: string;
  chatroomId: string;
  prompt: string;
}

export interface ConnectionTerminatedEvent extends EventStreamEventBase {
  type: 'connection.terminated';
  role: string;
  connectionId: string;
  machineId?: string;
  reason: string;
  chatroomId: string;
}

export interface WorkflowStartedEvent extends EventStreamEventBase {
  type: 'workflow.started';
  workflowKey: string;
  workflowId: string;
  createdBy: string;
  stepCount: number;
  steps?: {
    stepKey: string;
    description: string;
    assigneeRole?: string;
    dependsOn: string[];
    order: number;
  }[];
  chatroomId: string;
}

export interface WorkflowStepCompletedEvent extends EventStreamEventBase {
  type: 'workflow.stepCompleted';
  workflowKey: string;
  workflowId: string;
  stepKey: string;
  stepDescription?: string;
  completedBy?: string;
  chatroomId: string;
}

export interface WorkflowStepCancelledEvent extends EventStreamEventBase {
  type: 'workflow.stepCancelled';
  workflowKey: string;
  workflowId: string;
  stepKey: string;
  stepDescription?: string;
  cancelledBy?: string;
  reason: string;
  chatroomId: string;
}

export interface WorkflowCompletedEvent extends EventStreamEventBase {
  type: 'workflow.completed';
  workflowKey: string;
  workflowId: string;
  finalStatus: 'completed' | 'cancelled';
  chatroomId: string;
}

export interface WorkflowCreatedEvent extends EventStreamEventBase {
  type: 'workflow.created';
  workflowKey: string;
  workflowId: string;
  createdBy: string;
  stepCount: number;
  steps?: {
    stepKey: string;
    description: string;
    assigneeRole?: string;
    dependsOn: string[];
    order: number;
  }[];
  chatroomId: string;
}

export interface WorkflowSpecifiedEvent extends EventStreamEventBase {
  type: 'workflow.specified';
  workflowKey: string;
  workflowId: string;
  stepKey: string;
  chatroomId: string;
}

export interface WorkflowStepStartedEvent extends EventStreamEventBase {
  type: 'workflow.stepStarted';
  workflowKey: string;
  workflowId: string;
  stepKey: string;
  stepDescription?: string;
  assigneeRole?: string;
  chatroomId: string;
}

// ─── Config Event Types ──────────────────────────────────────────────────────

export interface ConfigRequestRemovalEvent extends EventStreamEventBase {
  type: 'config.requestRemoval';
  role: string;
  machineId: string;
  reason: string;
  chatroomId: string;
}

// ─── Daemon Event Types ──────────────────────────────────────────────────────

export interface DaemonPingEvent extends EventStreamEventBase {
  type: 'daemon.ping';
  machineId: string;
}

export interface DaemonPongEvent extends EventStreamEventBase {
  type: 'daemon.pong';
  machineId: string;
  pingEventId: string;
}

export interface DaemonGitRefreshEvent extends EventStreamEventBase {
  type: 'daemon.gitRefresh';
  machineId: string;
  workingDir: string;
}

export interface DaemonRefreshCapabilitiesEvent extends EventStreamEventBase {
  type: 'daemon.refreshCapabilities';
  machineId: string;
  batchId?: string;
}

export interface DaemonPickFolderEvent extends EventStreamEventBase {
  type: 'daemon.pickFolder';
  machineId: string;
  requestId: string;
}

export interface DaemonLocalActionEvent extends EventStreamEventBase {
  type: 'daemon.localAction';
  machineId: string;
  action: string;
  workingDir: string;
}

// ─── Command Event Types ─────────────────────────────────────────────────────

export interface CommandRunEvent extends EventStreamEventBase {
  type: 'command.run';
  machineId: string;
  workingDir: string;
  commandName: string;
  script: string;
  runId: string;
}

export interface CommandStopEvent extends EventStreamEventBase {
  type: 'command.stop';
  machineId: string;
  runId: string;
}

export interface EnhancerJobCreatedEvent extends EventStreamEventBase {
  type: 'enhancer.job.created';
  jobId: string;
  userId: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface EnhancerAttemptFailedEvent extends EventStreamEventBase {
  type: 'enhancer.attempt.failed';
  jobId: string;
  attemptCount: number;
  error: string;
  nextRetryAt?: number;
}

export interface EnhancerJobFailedEvent extends EventStreamEventBase {
  type: 'enhancer.job.failed';
  jobId: string;
  attemptCount: number;
  error: string;
}

export interface EnhancerJobCompleteEvent extends EventStreamEventBase {
  type: 'enhancer.job.complete';
  jobId: string;
  attemptCount: number;
}

export interface EnhancerJobCancelledEvent extends EventStreamEventBase {
  type: 'enhancer.job.cancelled';
  jobId: string;
  attemptCount: number;
}

// ─── Event Stream Event Union ────────────────────────────────────────────────

/**
 * Union of all event types. Use this as the canonical event type
 * for event stream entries.
 */
export type EventStreamEvent =
  | AgentStartedEvent
  | AgentExitedEvent
  | AgentCircuitOpenEvent
  | AgentRequestStartEvent
  | AgentRequestStopEvent
  | AgentRegisteredEvent
  | AgentWaitingEvent
  | AgentStartFailedEvent
  | AgentSessionResumeRequestedEvent
  | AgentSessionResumedEvent
  | AgentSessionResumeFailedEvent
  | AgentSessionReopenRetryEvent
  | AgentSessionCompactedEvent
  | AgentSessionAugmentedEvent
  | AgentResumeStormAbortedEvent
  | AgentRestartLimitReachedEvent
  | AgentStopTimeoutEvent
  | AgentHarnessSessionIdUpdatedEvent
  | AgentAwaitingHandoffEvent
  | AgentTaskDeliveredEvent
  | AgentTaskDeliveryFailedEvent
  | MachineSwitchedEvent
  | TaskActivatedEvent
  | TaskAcknowledgedEvent
  | TaskInProgressEvent
  | TaskCompletedEvent
  | SkillActivatedEvent
  | ConnectionTerminatedEvent
  | WorkflowStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepCancelledEvent
  | WorkflowCompletedEvent
  | WorkflowCreatedEvent
  | WorkflowSpecifiedEvent
  | WorkflowStepStartedEvent
  | ConfigRequestRemovalEvent
  | DaemonPingEvent
  | DaemonPongEvent
  | DaemonGitRefreshEvent
  | DaemonRefreshCapabilitiesEvent
  | DaemonPickFolderEvent
  | DaemonLocalActionEvent
  | CommandRunEvent
  | CommandStopEvent
  | EnhancerJobCreatedEvent
  | EnhancerAttemptFailedEvent
  | EnhancerJobFailedEvent
  | EnhancerJobCompleteEvent
  | EnhancerJobCancelledEvent;
