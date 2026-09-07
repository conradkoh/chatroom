import { randomUUID } from 'node:crypto';

import type {
  EnsureRunningOpts,
  HandleExitOpts,
  OperationResult,
  StopOpts,
} from '../../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';
import type { AgentSlot } from '../agent-process-manager.js';
import type {
  CommandNotification,
  CommandNotificationFilter,
  CommandNotificationListener,
  CommandNotifier,
} from '../components/command-notifier/index.js';
import {
  CommandQueueConsumer,
  createCommandQueue,
  type CommandQueueConsumerOptions,
  type ReceivedCommandMessage,
} from '../components/command-queue/index.js';

export interface RestartAgentInput {
  readonly chatroomId: string;
  readonly role: string;
}

export type AgentProcessManagerCommand =
  | { readonly operationId: string; readonly type: 'start'; readonly input: EnsureRunningOpts }
  | { readonly operationId: string; readonly type: 'stop'; readonly input: StopOpts }
  | { readonly operationId: string; readonly type: 'restart'; readonly input: RestartAgentInput }
  | {
      readonly operationId: string;
      readonly type: 'recover';
      readonly input: Record<string, never>;
    };

export type AgentOperationResult = CommandNotification<AgentProcessManagerCommand>;

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
  startAgent(input: EnsureRunningOpts): Promise<AgentOperationResult>;
  /** Enqueue a stop operation for one chatroom/role agent. */
  stopAgent(input: StopOpts): Promise<AgentOperationResult>;
  /** Enqueue a restart operation for one chatroom/role agent. */
  restartAgent(input: RestartAgentInput): Promise<AgentOperationResult>;
  /** Enqueue the manager recovery operation. */
  recoverAgents(): Promise<AgentOperationResult>;
  /** Subscribe to execution outcomes from lifecycle commands. */
  subscribe(
    filter: CommandNotificationFilter,
    listener: CommandNotificationListener<AgentProcessManagerCommand>
  ): () => void;

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
  notifier: CommandNotifier<AgentProcessManagerCommand>;
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

function assertStopSucceeded(result: { success: boolean }): void {
  if (!result.success) {
    throw new Error('Agent stop failed');
  }
}

interface PendingOperation {
  resolve(result: AgentOperationResult): void;
  reject(error: unknown): void;
}

/**
 * Composes the imperative service API with the FIFO command queue.
 *
 * Lifecycle methods submit commands and resolve after the consumer completes
 * the command. Callers can use `void service.stopAgent(...)` when completion
 * is intentionally fire-and-forget.
 */
export function createAgentProcessManagerService(
  deps: AgentProcessManagerServiceDependencies
): AgentProcessManagerService {
  const queue = createCommandQueue<AgentProcessManagerCommand>();
  const pendingOperations = new Map<string, PendingOperation>();

  deps.notifier.subscribe({}, (notification) => {
    const pending = pendingOperations.get(notification.operationId);
    if (!pending) return;
    pendingOperations.delete(notification.operationId);
    if (notification.status === 'succeeded') pending.resolve(notification);
    else pending.reject(notification.error ?? new Error('Agent lifecycle command failed'));
  });

  const consumer = new CommandQueueConsumer({
    queue,
    notifier: deps.notifier,
    ...deps.consumer,
    dispatch: async (message: ReceivedCommandMessage<AgentProcessManagerCommand>) => {
      const { type, input } = message.body;
      switch (type) {
        case 'start':
          assertStartSucceeded(await deps.execution.ensureRunning(input));
          return;
        case 'stop':
          assertStopSucceeded(await deps.execution.stop(input));
          return;
        case 'restart':
          await deps.restartAgent(input);
          return;
        case 'recover':
          await deps.execution.recover();
          return;
      }
    },
  });

  const submit = (
    commandFactory: (operationId: string) => AgentProcessManagerCommand
  ): Promise<AgentOperationResult> => {
    const operationId = randomUUID();
    const completion = new Promise<AgentOperationResult>((resolve, reject) => {
      pendingOperations.set(operationId, { resolve, reject });
    });
    const command = commandFactory(operationId);
    const message = commandMessage(command);
    void queue.sendMessage(message).catch((error: unknown) => {
      const pending = pendingOperations.get(operationId);
      if (!pending) return;
      pendingOperations.delete(operationId);
      pending.reject(error);
    });
    return completion;
  };

  return {
    startAgent: (input) => submit((operationId) => ({ operationId, type: 'start', input })),
    stopAgent: (input) => submit((operationId) => ({ operationId, type: 'stop', input })),
    restartAgent: (input) => submit((operationId) => ({ operationId, type: 'restart', input })),
    recoverAgents: () => submit((operationId) => ({ operationId, type: 'recover', input: {} })),
    subscribe: (filter, listener) => deps.notifier.subscribe(filter, listener),
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
