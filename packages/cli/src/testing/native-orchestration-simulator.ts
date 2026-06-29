/**
 * NativeOrchestrationSimulator — closed-loop native injection tests without a daemon.
 *
 * Wires runNativeInjectionEffect against a RecordingHarness and mocked Convex backend.
 */

import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { parseSessionAugmentation } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect } from 'effect';

import { RecordingHarness } from './recording-harness.js';
import { api } from '../api.js';
import { NativeDeliveryLedger } from '../commands/machine/daemon-start/native-delivery-ledger.js';
import { buildNativeInjectionPrompt } from '../commands/machine/daemon-start/native-task-injector-logic.js';
import { runNativeInjectionEffect } from '../commands/machine/daemon-start/native-task-injector.js';

export interface SimulateInjectionOptions {
  task: AssignedTaskView;
  deliveryOutput: string;
  sessionId?: string;
  convexUrl?: string;
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
      agentHarness: 'opencode-sdk',
      workingDir: '/tmp/project',
      spawnedAgentPid: 12345,
      desiredState: 'running',
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
      args.action === NATIVE_TASK_INJECTED_ACTION ||
      fn === api.machines.emitSessionCompacted
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
  readonly ledger = new NativeDeliveryLedger();
  readonly harnessSessionId: string;
  readonly sessionId: string;
  readonly convexUrl: string;

  constructor(options?: { sessionId?: string; convexUrl?: string; harnessSessionId?: string }) {
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
      augmentationMode: parseSessionAugmentation(task.taskContent),
    });
  }

  async inject(options: SimulateInjectionOptions): Promise<string> {
    const { task, deliveryOutput } = options;
    const sessionId = options.sessionId ?? this.sessionId;
    const convexUrl = options.convexUrl ?? this.convexUrl;
    const expected = this.expectedPrompt(task, deliveryOutput);
    const backend = createBackendMock(deliveryOutput);

    await Effect.runPromise(
      runNativeInjectionEffect(
        task,
        this.harnessSessionId,
        {
          sessionId,
          machineId: task.agentConfig.machineId,
          convexUrl,
          backend,
          agentMgr: this.harness,
        },
        this.ledger
      )
    );

    const recorded = this.harness.lastInjection();
    if (!recorded || recorded.prompt !== expected) {
      throw new Error('Injected prompt does not match expected native injection shape');
    }

    return expected;
  }
}
