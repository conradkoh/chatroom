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

export type AgentProcessManagerResetInput =
  | { readonly scope: 'chatroom'; readonly chatroomId: string }
  | { readonly scope: 'chatroom-role'; readonly chatroomId: string; readonly role: string };

export interface AgentKey {
  readonly chatroomId: string;
  readonly role: string;
}

export interface SerializedAgentOperations {
  startAgent(input: EnsureRunningOpts, signal: AbortSignal): Promise<OperationResult>;
  stopAgent(input: StopOpts, signal: AbortSignal): Promise<{ success: boolean }>;
}

export interface SerializedAgentOperationOptions {
  readonly timeoutMs: number;
}

export interface SerializedAgentOperationContext {
  readonly signal: AbortSignal;
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
  reset(input: AgentProcessManagerResetInput): Promise<void>;

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
  /**
   * Stop command processing, cancel queued callers, and restore the manager to
   * a known empty state. Processing resumes if it was active before reset.
   */
  reset(input: AgentProcessManagerResetInput): Promise<AgentProcessManagerResetResult>;
  /**
   * Run a compound operation exclusively for one agent key. The supplied
   * lifecycle operations execute inside the same serialized section; callers
   * must use them instead of calling the service lifecycle methods recursively.
   */
  runSerializedForAgent<T>(
    key: AgentKey,
    options: SerializedAgentOperationOptions,
    operation: (
      ops: SerializedAgentOperations,
      context: SerializedAgentOperationContext
    ) => Promise<T>
  ): Promise<T>;
  /** Subscribe to execution outcomes from lifecycle commands. */
  subscribe(
    filter: CommandNotificationFilter,
    listener: CommandNotificationListener<AgentProcessManagerCommand>
  ): () => void;

  /** Start and stop the internal queue polling loop. */
  startProcessing(): void;
  stopProcessing(): Promise<void>;

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

export interface AgentProcessManagerResetResult {
  readonly input: AgentProcessManagerResetInput;
  readonly cancelledOperationIds: readonly string[];
  readonly purgedMessageCount: number;
}

export interface AgentProcessManagerServiceDependencies {
  execution: AgentProcessManagerExecutionPort;
  restartAgent?: (input: RestartAgentInput) => Promise<void>;
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
  const agentOperationTails = new Map<string, Promise<void>>();
  let processingStarted = false;
  let resetting = false;

  const keyFor = (key: AgentKey): string => messageGroupId(key);

  const runExclusive = <T>(key: AgentKey, operation: () => Promise<T>): Promise<T> => {
    const groupId = keyFor(key);
    const previous = agentOperationTails.get(groupId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    agentOperationTails.set(groupId, tail);
    void tail.finally(() => {
      if (agentOperationTails.get(groupId) === tail) agentOperationTails.delete(groupId);
    });
    return current;
  };

  const runSerializedForAgent = <T>(
    key: AgentKey,
    options: SerializedAgentOperationOptions,
    operation: (
      ops: SerializedAgentOperations,
      context: SerializedAgentOperationContext
    ) => Promise<T>
  ): Promise<T> => {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      return Promise.reject(new Error('Serialized agent operation timeout must be positive'));
    }

    const controller = new AbortController();
    const timeoutError = new Error('Serialized agent operation timed out');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const serializedPromise = runExclusive(key, async () => {
      if (controller.signal.aborted) throw controller.signal.reason ?? timeoutError;
      return operation(
        {
          startAgent: async (input, signal) => {
            if (signal.aborted) throw signal.reason ?? new Error('Agent operation cancelled');
            const result = await deps.execution.ensureRunning(input);
            assertStartSucceeded(result);
            return result;
          },
          stopAgent: async (input, signal) => {
            if (signal.aborted) throw signal.reason ?? new Error('Agent operation cancelled');
            const result = await deps.execution.stop(input);
            assertStopSucceeded(result);
            return result;
          },
        },
        { signal: controller.signal }
      );
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, options.timeoutMs);
    });
    return Promise.race([serializedPromise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

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
          if (!deps.restartAgent) {
            throw new Error('Agent process manager restart execution is not wired yet');
          }
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
    startAgent: (input) => {
      if (resetting) return Promise.reject(new Error('Agent process manager is resetting'));
      return runExclusive(input, () =>
        submit((operationId) => ({ operationId, type: 'start', input }))
      );
    },
    stopAgent: (input) => {
      if (resetting) return Promise.reject(new Error('Agent process manager is resetting'));
      return runExclusive(input, () =>
        submit((operationId) => ({ operationId, type: 'stop', input }))
      );
    },
    restartAgent: (input) => {
      if (resetting) return Promise.reject(new Error('Agent process manager is resetting'));
      return runExclusive(input, () =>
        submit((operationId) => ({ operationId, type: 'restart', input }))
      );
    },
    recoverAgents: () => {
      if (resetting) return Promise.reject(new Error('Agent process manager is resetting'));
      return submit((operationId) => ({ operationId, type: 'recover', input: {} }));
    },
    reset: async (input) => {
      if (resetting) throw new Error('Agent process manager reset is already in progress');
      resetting = true;
      const wasProcessing = processingStarted;
      // Allow lifecycle calls accepted immediately before reset to enqueue
      // before the purge boundary is reached.
      await Promise.resolve();
      if (wasProcessing) await consumer.stop();

      try {
        await deps.execution.reset(input);
        const messageGroupPrefix =
          input.scope === 'chatroom'
            ? `${input.chatroomId}:`
            : `${input.chatroomId}:${input.role.toLowerCase()}`;
        const purgedMessages = await queue.purge({
          scope: 'message-group-prefix',
          messageGroupPrefix,
        });
        const cancelledOperationIds = new Set<string>();
        const cancellationError = new Error('Agent process manager reset cancelled the command');

        for (const message of purgedMessages) {
          const operationId =
            typeof message.body === 'object' &&
            message.body !== null &&
            'operationId' in message.body &&
            typeof message.body.operationId === 'string'
              ? message.body.operationId
              : message.messageId;
          cancelledOperationIds.add(operationId);
          deps.notifier.publish({
            eventId: randomUUID(),
            operationId,
            messageId: message.messageId,
            messageGroupId: message.messageGroupId,
            body: message.body,
            status: 'cancelled',
            completedAt: Date.now(),
            receiveCount: message.receiveCount,
            error: cancellationError,
          });
        }

        for (const [operationId, pending] of pendingOperations) {
          if (!cancelledOperationIds.has(operationId)) continue;
          pendingOperations.delete(operationId);
          pending.reject(cancellationError);
        }

        if (wasProcessing) consumer.start();

        return {
          input,
          cancelledOperationIds: [...cancelledOperationIds],
          purgedMessageCount: purgedMessages.length,
        };
      } finally {
        resetting = false;
      }
    },
    runSerializedForAgent,
    subscribe: (filter, listener) => deps.notifier.subscribe(filter, listener),
    startProcessing: () => {
      processingStarted = true;
      consumer.start();
    },
    stopProcessing: async () => {
      processingStarted = false;
      await consumer.stop();
    },
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
