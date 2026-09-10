import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { createDaemonAgentCommandService as createDomainAgentCommandService } from './agent-command-service.js';
import { createAgentCommandInbox } from '../../../infrastructure/convex/agent-command-inbox.js';
import { createAgentCommandFactOutbox } from '../../../infrastructure/outbox/agent-command-fact-outbox.js';
import { createAgentCommandFactSend } from '../../../infrastructure/outbox/agent-command-fact-send.js';
import type { AgentProcessManagerService } from '../../agent-process-service/index.js';
import type { AgentStopCommand } from '../domain/entities/agent-command.js';
import {
  startAgentCommandInboxConsumer,
  type AgentCommandInboxConsumer,
} from '../service/agent-command-inbox-consumer.js';
import type { AgentCommandService } from '../service/agent-command-service.js';

export type AgentCommandServiceStatus =
  'starting' | 'running' | 'stopping' | 'stopped' | 'degraded';

export type AgentCommandServiceState = {
  readonly status: AgentCommandServiceStatus;
  readonly activeCommandId?: string | undefined;
  readonly activeIntentId?: string | undefined;
  readonly processedCount: number;
  readonly failedCount: number;
  readonly lastFactAt?: number | undefined;
  readonly lastError?: string | undefined;
};

export interface DaemonAgentCommandService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): AgentCommandServiceState;
  subscribe(listener: (state: AgentCommandServiceState) => void): () => void;
}

export interface DaemonAgentCommandServiceDependencies {
  readonly wsClient: ConvexClient;
  readonly backend: {
    mutation: (fn: unknown, args: unknown) => Promise<unknown>;
  };
  readonly sessionId: string;
  readonly machineId: string;
  readonly processManager: AgentProcessManagerService;
}

type MutableState = {
  status: AgentCommandServiceStatus;
  activeCommandId?: string | undefined;
  activeIntentId?: string | undefined;
  processedCount: number;
  failedCount: number;
  lastFactAt?: number | undefined;
  lastError?: string | undefined;
};

function snapshot(state: MutableState): AgentCommandServiceState {
  return { ...state };
}

export function createDaemonAgentCommandServiceRuntime(
  deps: DaemonAgentCommandServiceDependencies
): DaemonAgentCommandService {
  const state: MutableState = {
    status: 'stopped',
    processedCount: 0,
    failedCount: 0,
  };
  const listeners = new Set<(state: AgentCommandServiceState) => void>();
  let consumer: AgentCommandInboxConsumer | undefined;
  let factOutbox: ReturnType<typeof createAgentCommandFactOutbox> | undefined;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  const publish = (): void => {
    const current = snapshot(state);
    for (const listener of listeners) listener(current);
  };

  const setState = (patch: Partial<MutableState>): void => {
    Object.assign(state, patch);
    publish();
  };

  const reportError = (error: unknown): void => {
    state.failedCount += 1;
    setState({
      status: 'degraded',
      lastError: error instanceof Error ? error.message : String(error),
    });
  };

  const createCommandService = (factSink: NonNullable<typeof factOutbox>): AgentCommandService => {
    const service = createDomainAgentCommandService({
      processManager: deps.processManager,
      factSink,
    });
    return {
      stop: async (command: AgentStopCommand) => {
        setState({
          status: 'running',
          activeCommandId: command.commandId,
          activeIntentId: command.intentId,
          lastError: undefined,
        });
        try {
          const result = await service.stop(command);
          state.processedCount += 1;
          if (result.facts.length > 0)
            state.lastFactAt = result.facts.reduce(
              (latest, fact) => Math.max(latest, fact.occurredAt),
              state.lastFactAt ?? 0
            );
          setState({
            status: result.status === 'partial_failure' ? 'degraded' : 'running',
            activeCommandId: undefined,
            activeIntentId: undefined,
          });
          return result;
        } catch (error) {
          setState({
            status: 'degraded',
            activeCommandId: undefined,
            activeIntentId: undefined,
          });
          throw error;
        }
      },
    };
  };

  const doStart = async (): Promise<void> => {
    if (state.status === 'running') return;
    setState({ status: 'starting', lastError: undefined });
    try {
      const inbox = createAgentCommandInbox({
        wsClient: deps.wsClient,
        backend: deps.backend,
        sessionId: deps.sessionId as SessionId,
        machineId: deps.machineId,
      });
      factOutbox = createAgentCommandFactOutbox(deps.machineId, () =>
        createAgentCommandFactSend({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          backend: deps.backend,
        })
      );
      consumer = startAgentCommandInboxConsumer({
        inbox,
        service: createCommandService(factOutbox),
        onError: reportError,
      });
      setState({ status: 'running' });
    } catch (error) {
      reportError(error);
      await factOutbox?.stopAll().catch(() => undefined);
      factOutbox = undefined;
      consumer = undefined;
      throw error;
    }
  };

  return {
    start: () => {
      startPromise ??= doStart().finally(() => {
        startPromise = undefined;
      });
      return startPromise;
    },
    stop: () => {
      stopPromise ??= (async () => {
        await startPromise?.catch(() => undefined);
        if (!consumer && !factOutbox) {
          setState({ status: 'stopped' });
          return;
        }
        setState({ status: 'stopping' });
        const activeConsumer = consumer;
        const activeOutbox = factOutbox;
        consumer = undefined;
        factOutbox = undefined;
        try {
          await activeConsumer?.stop();
          await activeOutbox?.stopAll();
          setState({
            status: 'stopped',
            activeCommandId: undefined,
            activeIntentId: undefined,
          });
        } catch (error) {
          reportError(error);
          throw error;
        }
      })().finally(() => {
        stopPromise = undefined;
      });
      return stopPromise;
    },
    getState: () => snapshot(state),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(snapshot(state));
      return () => listeners.delete(listener);
    },
  };
}
