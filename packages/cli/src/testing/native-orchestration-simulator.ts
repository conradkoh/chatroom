// fallow-ignore-file unused-file
/**
 * NativeOrchestrationSimulator — closed-loop native injection tests without a daemon.
 *
 * Wires runNativeInjectionEffect against a RecordingHarness and mocked Convex backend.
 */

import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { Effect } from 'effect';

import { RecordingHarness } from './recording-harness.js';
import {
  buildNativeInjectionPrompt,
  NativeInjectionDedup,
} from '../commands/machine/daemon-start/native-task-injector-logic.js';
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

function createBackendMock(deliveryOutput: string) {
  // fallow-ignore-next-line complexity
  const mutation = async (_fn: unknown, args: Record<string, unknown>) => {
    if (args.taskId && args.role && args.chatroomId && !('action' in args)) {
      return undefined;
    }
    if (args.action === NATIVE_TASK_INJECTED_ACTION) {
      return undefined;
    }
    throw new Error(`Unexpected mutation call: ${JSON.stringify(Object.keys(args))}`);
  };

  const query = async (_fn: unknown) => ({ fullCliOutput: deliveryOutput });

  return { mutation, query };
}

export class NativeOrchestrationSimulator {
  readonly harness = new RecordingHarness();
  readonly dedup = new NativeInjectionDedup();
  readonly sessionId: string;
  readonly convexUrl: string;

  // fallow-ignore-next-line complexity
  constructor(options?: { sessionId?: string; convexUrl?: string }) {
    this.sessionId = options?.sessionId ?? 'test-session';
    this.convexUrl = options?.convexUrl ?? 'http://127.0.0.1:3210';
  }

  static makeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
    return makeBaseTask(overrides);
  }

  expectedPrompt(task: AssignedTaskView, deliveryOutput: string): string {
    return buildNativeInjectionPrompt({
      taskDeliveryOutput: deliveryOutput,
      compressMode: parseCompressContext(task.taskContent),
    });
  }

  // fallow-ignore-next-line complexity
  async inject(options: SimulateInjectionOptions): Promise<string> {
    const { task, deliveryOutput } = options;
    const sessionId = options.sessionId ?? this.sessionId;
    const convexUrl = options.convexUrl ?? this.convexUrl;
    const expected = this.expectedPrompt(task, deliveryOutput);
    const backend = createBackendMock(deliveryOutput);

    await Effect.runPromise(
      runNativeInjectionEffect(
        task,
        {
          sessionId,
          convexUrl,
          backend,
          agentMgr: this.harness,
        },
        this.dedup
      )
    );

    const recorded = this.harness.lastInjection();
    if (!recorded || recorded.prompt !== expected) {
      throw new Error('Injected prompt does not match expected native injection shape');
    }

    return expected;
  }
}
