import type {
  EnsureRunningOpts,
  HandleExitOpts,
  OperationResult,
  StopOpts,
} from '../../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';
import type { AgentSlot } from '../agent-process-manager.js';
import {
  CommandQueueConsumer,
  createCommandQueue,
  type CommandQueueConsumerOptions,
  type ReceivedCommandMessage,
  type SentCommandMessage,
} from '../components/command-queue/index.js';

export interface RestartAgentInput {
  readonly chatroomId: string;
  readonly role: string;
}

export interface AgentProcessManagerCommand {
  readonly type: 'start' | 'stop' | 'restart' | 'recover';
  readonly input: EnsureRunningOpts | StopOpts | RestartAgentInput | Record<string, never>;
}

export interface AgentProcessManagerExecutionPort {
  ensureRunning(opts: EnsureRunningOpts): Promise<OperationResult>;
  stop(opts: StopOpts): Promise<{ success: boolean }>;
  handleExit(opts: HandleExitOpts): Promise<void>;
  recover(): Promise<void>;

  getSlot(chatroomId: string, role: string): AgentSlot | undefined;
  listActive(): { chatroomId: string; role: string; slot: AgentSlot }[];
  clearStuckStoppingSlot(
    chatroomId: string,
    role: string,
    options?: { clearStopIntent?: boolean }
  ): Promise<boolean>;
  whenTurnEndsIdle(): Promise<void>;
  resumeTurnForSlot(args: { chatroomId: string; role: string; prompt: string }): Promise<void>;
  setLastInFlightTask(chatroomId: string, role: string, taskId: string): void;
  clearLastInFlightTaskIfMatches(chatroomId: string, role: string, taskId: string): void;
  reconcileNativeTurnPhaseIdle(chatroomId: string, role: string): void;
}

export interface AgentProcessManagerService {
  /** Enqueue a start operation for one chatroom/role agent. */
  startAgent(input: EnsureRunningOpts): Promise<SentCommandMessage>;
  /** Enqueue a stop operation for one chatroom/role agent. */
  stopAgent(input: StopOpts): Promise<SentCommandMessage>;
  /** Enqueue a restart operation for one chatroom/role agent. */
  restartAgent(input: RestartAgentInput): Promise<SentCommandMessage>;
  /** Enqueue the manager recovery operation. */
  recoverAgents(): Promise<SentCommandMessage>;

  /** Start and stop the internal queue polling loop. */
  startProcessing(): void;
  stopProcessing(): void;

  /** Non-lifecycle manager operations exposed through the same boundary. */
  handleExit(opts: HandleExitOpts): Promise<void>;
  getSlot(chatroomId: string, role: string): AgentSlot | undefined;
  listActive(): { chatroomId: string; role: string; slot: AgentSlot }[];
  clearStuckStoppingSlot(
    chatroomId: string,
    role: string,
    options?: { clearStopIntent?: boolean }
  ): Promise<boolean>;
  whenTurnEndsIdle(): Promise<void>;
  resumeTurnForSlot(args: { chatroomId: string; role: string; prompt: string }): Promise<void>;
  setLastInFlightTask(chatroomId: string, role: string, taskId: string): void;
  clearLastInFlightTaskIfMatches(chatroomId: string, role: string, taskId: string): void;
  reconcileNativeTurnPhaseIdle(chatroomId: string, role: string): void;
}

export interface AgentProcessManagerServiceDependencies {
  execution: AgentProcessManagerExecutionPort;
  restartAgent(input: RestartAgentInput): Promise<void>;
  consumer?: CommandQueueConsumerOptions;
}

function messageGroupId(input: { chatroomId: string; role: string }): string {
  return `${input.chatroomId}:${input.role.toLowerCase()}`;
}

function commandMessage(command: AgentProcessManagerCommand): {
  body: AgentProcessManagerCommand;
  messageGroupId: string;
} {
  if (command.type === 'recover') {
    return { body: command, messageGroupId: 'machine' };
  }

  const input = command.input as { chatroomId: string; role: string };
  return { body: command, messageGroupId: messageGroupId(input) };
}

function assertStartSucceeded(result: OperationResult): void {
  if (!result.success) {
    throw new Error(`Agent start failed${result.error ? `: ${result.error}` : ''}`);
  }
}

/**
 * Composes the imperative service API with the FIFO command queue.
 *
 * Lifecycle methods submit commands and return once the command has been
 * accepted by the queue. The consumer executes commands serially per
 * chatroom/role group.
 */
export function createAgentProcessManagerService(
  deps: AgentProcessManagerServiceDependencies
): AgentProcessManagerService {
  const queue = createCommandQueue<AgentProcessManagerCommand>();
  const consumer = new CommandQueueConsumer({
    queue,
    ...deps.consumer,
    dispatch: async (message: ReceivedCommandMessage<AgentProcessManagerCommand>) => {
      const { type, input } = message.body;
      switch (type) {
        case 'start':
          assertStartSucceeded(await deps.execution.ensureRunning(input as EnsureRunningOpts));
          return;
        case 'stop':
          await deps.execution.stop(input as StopOpts);
          return;
        case 'restart':
          await deps.restartAgent(input as RestartAgentInput);
          return;
        case 'recover':
          await deps.execution.recover();
          return;
      }
    },
  });

  const submit = (command: AgentProcessManagerCommand): Promise<SentCommandMessage> => {
    const message = commandMessage(command);
    return queue.sendMessage(message);
  };

  return {
    startAgent: (input) => submit({ type: 'start', input }),
    stopAgent: (input) => submit({ type: 'stop', input }),
    restartAgent: (input) => submit({ type: 'restart', input }),
    recoverAgents: () => submit({ type: 'recover', input: {} }),
    startProcessing: () => consumer.start(),
    stopProcessing: () => consumer.stop(),
    handleExit: (input) => deps.execution.handleExit(input),
    getSlot: (chatroomId, role) => deps.execution.getSlot(chatroomId, role),
    listActive: () => deps.execution.listActive(),
    clearStuckStoppingSlot: (chatroomId, role, options) =>
      deps.execution.clearStuckStoppingSlot(chatroomId, role, options),
    whenTurnEndsIdle: () => deps.execution.whenTurnEndsIdle(),
    resumeTurnForSlot: (input) => deps.execution.resumeTurnForSlot(input),
    setLastInFlightTask: (chatroomId, role, taskId) =>
      deps.execution.setLastInFlightTask(chatroomId, role, taskId),
    clearLastInFlightTaskIfMatches: (chatroomId, role, taskId) =>
      deps.execution.clearLastInFlightTaskIfMatches(chatroomId, role, taskId),
    reconcileNativeTurnPhaseIdle: (chatroomId, role) =>
      deps.execution.reconcileNativeTurnPhaseIdle(chatroomId, role),
  };
}
