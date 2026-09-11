/**
 * NativeOrchestrationSimulator — closed-loop native injection tests without a daemon.
 *
 * Wires runNativeInjectionEffect against a RecordingHarness and mocked Convex backend.
 */

import { resolveSessionAugmentationForTask } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect } from 'effect';

import { RecordingHarness } from './recording-harness.js';
import { api } from '../api.js';
import { TaskAssigneeType } from '../daemon/domain/entities/assigned-task.js';
import {
  buildNativeInjectionPrompt,
  createConvexNativeTaskDeliveryGateway,
  createDaemonAuditPort,
} from '../daemon/services/service-interfaces.js';
import {
  runNativeInjectionEffect,
  type NativeInjectorDeps,
} from '../daemon/services/service-interfaces.js';

export interface SimulateInjectionOptions {
  task: AssignedTaskView;
  deliveryOutput: string;
  sessionId?: string | undefined;
  convexUrl?: string | undefined;
}

function makeBaseTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
  return {
    taskId: 'task_1' as AssignedTaskView['taskId'],
    chatroomId: 'room_1' as AssignedTaskView['chatroomId'],
    status: 'pending',
    assignedTo: 'planner',
    taskContent: 'hello',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'planner',
      machineId: 'machine_1',
      spawnedAgentPid: 12345,
      desiredState: 'running',
    },
    assignee: {
      type: TaskAssigneeType.Ephemeral,
      ephemeral: { agentHarness: 'opencode-sdk', model: 'model-1', workingDir: '/tmp/project' },
    },
    participant: {
      lastSeenAction: 'native:waiting',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

function isClaimMutation(args: Record<string, unknown>): boolean {
  return Boolean(args.taskId && args.role && args.chatroomId && !('action' in args));
}

function createBackendMock(deliveryOutput: string) {
  const mutation = async (fn: unknown, args: Record<string, unknown>) => {
    if (
      isClaimMutation(args) ||
      'deliveryKind' in args ||
      fn === api.machines.emitSessionAugmented ||
      fn === api.daemon.agentEvents.sessionAugmented
    ) {
      return undefined;
    }
    throw new Error(`Unexpected mutation call: ${JSON.stringify(Object.keys(args))}`);
  };

  const query = async (_fn: unknown) => ({ fullCliOutput: deliveryOutput });

  return { mutation, query };
}

export class NativeOrchestrationSimulator {
  readonly harness = new RecordingHarness();
  readonly harnessSessionId: string;
  readonly sessionId: string;
  readonly convexUrl: string;

  constructor(options?: {
    sessionId?: string | undefined;
    convexUrl?: string | undefined;
    harnessSessionId?: string | undefined;
  }) {
    this.sessionId = options?.sessionId ?? 'test-session';
    this.convexUrl = options?.convexUrl ?? 'http://127.0.0.1:3210';
    this.harnessSessionId = options?.harnessSessionId ?? 'test-harness-session';
  }

  static makeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
    return makeBaseTask(overrides);
  }

  expectedPrompt(task: AssignedTaskView, deliveryOutput: string): string {
    return buildNativeInjectionPrompt({
      taskDeliveryOutput: deliveryOutput,
      augmentationMode: resolveSessionAugmentationForTask(
        { content: task.taskContent, startInNewSession: task.startInNewSession },
        task.agentConfig.role
      ),
    });
  }

  async inject(options: SimulateInjectionOptions): Promise<string> {
    const { task, deliveryOutput } = options;
    const sessionId = options.sessionId ?? this.sessionId;
    const convexUrl = options.convexUrl ?? this.convexUrl;
    const expected = this.expectedPrompt(task, deliveryOutput);
    const backend = createBackendMock(deliveryOutput);
    const logEvent = async () => undefined;

    await Effect.runPromise(
      runNativeInjectionEffect(task, this.harnessSessionId, {
        sessionId,
        machineId: task.agentConfig.machineId,
        logEvent,
        convexUrl,
        backend,
        taskGateway: createConvexNativeTaskDeliveryGateway(backend),
        audit: createDaemonAuditPort(logEvent),
        lifecycleOutbox: { enqueue: async () => ({ success: true }) },
        agentMgr: this.harness,
        runSerializedForAgent: (async (_key, _options, operation) =>
          operation(
            {
              startAgent: async (input, signal) => {
                if (signal.aborted) throw signal.reason;
                const result = await this.harness.ensureRunning(input as never);
                if (!result.success) throw new Error('start failed');
                return result;
              },
              stopAgent: async (input, signal) => {
                if (signal.aborted) throw signal.reason;
                const result = await this.harness.stop(input);
                if (!result.success) throw new Error('stop failed');
                return result;
              },
            },
            { signal: new AbortController().signal }
          )) as NativeInjectorDeps['runSerializedForAgent'],
      })
    );

    const recorded = this.harness.lastInjection();
    if (!recorded || recorded.prompt !== expected) {
      throw new Error('Injected prompt does not match expected native injection shape');
    }

    return expected;
  }
}
