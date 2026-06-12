/**
 * Workflow Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createWorkflowEffect,
  specifyWorkflowStepEffect,
  executeWorkflowEffect,
  getWorkflowStatusEffect,
  completeStepEffect,
  exitWorkflowEffect,
  viewStepEffect,
  type WorkflowError,
  type CreateWorkflowOptions,
  type SpecifyStepOptions,
  type ExecuteWorkflowOptions,
  type WorkflowStatusOptions,
  type StepCompleteOptions,
  type ExitWorkflowOptions,
  type ViewStepOptions,
} from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable query and mutation responses */
function makeTestBackend(config: {
  mutationResponse?: unknown | Error;
  queryResponse?: unknown | Error;
}) {
  return Layer.succeed(BackendService, {
    query: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.queryResponse instanceof Error) {
        return Effect.fail(config.queryResponse) as any;
      }
      return Effect.succeed(config.queryResponse) as any;
    }),
    mutation: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.mutationResponse instanceof Error) {
        return Effect.fail(config.mutationResponse) as any;
      }
      return Effect.succeed(config.mutationResponse) as any;
    }),
    action: vi.fn(() => Effect.fail(new Error('Action not used in workflow')) as any),
  });
}

/** Create a test session service with configurable responses */
function makeTestSession(config: {
  sessionId?: string | null;
  convexUrl?: string;
  otherUrls?: string[];
}) {
  return Layer.succeed(SessionService, {
    getSessionId: () =>
      Effect.succeed(
        (config.sessionId !== undefined
          ? config.sessionId
          : 'test-session-id') as unknown as SessionId
      ),
    getConvexUrl: () => Effect.succeed(config.convexUrl ?? 'https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed(config.otherUrls ?? []),
  });
}

/** Extract the typed WorkflowError from a Failure exit */
function extractError(
  exit: Awaited<ReturnType<typeof Effect.runPromiseExit>>
): WorkflowError | null {
  if (exit._tag !== 'Failure') return null;
  return Cause.failureOption(exit.cause).pipe((option) =>
    option._tag === 'Some' ? option.value : null
  ) as WorkflowError | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
const shortChatroomId = 'tooshort'; // < 20 chars - invalid

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('createWorkflowEffect', () => {
  const validOptions: CreateWorkflowOptions = {
    role: 'planner',
    workflowKey: 'deploy-v1',
    stdinContent: JSON.stringify({
      steps: [
        { stepKey: 'setup', description: 'Initial setup', dependsOn: [], order: 1 },
        { stepKey: 'build', description: 'Build the app', dependsOn: ['setup'], order: 2 },
      ],
    }),
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid JSON and successful mutation', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: { workflowId: 'wf_abc123' } }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      createWorkflowEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({
        sessionId: null,
        convexUrl: 'https://test.convex.cloud',
        otherUrls: ['https://prod.convex.cloud'],
      })
    );

    const exit = await Effect.runPromiseExit(
      createWorkflowEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
    if (error?._tag === 'NotAuthenticated') {
      expect(error.convexUrl).toBe('https://test.convex.cloud');
      expect(error.otherUrls).toEqual(['https://prod.convex.cloud']);
    }
  });

  test('fails with InvalidInput when JSON is malformed', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const badOptions: CreateWorkflowOptions = { ...validOptions, stdinContent: 'not-json{{{' };

    const exit = await Effect.runPromiseExit(
      createWorkflowEffect(validChatroomId, badOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('InvalidInput');
  });

  test('fails with InvalidChatroomId when ID is too short', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      createWorkflowEffect(shortChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('InvalidChatroomId');
    if (error?._tag === 'InvalidChatroomId') {
      expect(error.id).toBe(shortChatroomId);
    }
  });

  test('fails with InvalidInput when steps array is empty', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const emptyOptions: CreateWorkflowOptions = {
      ...validOptions,
      stdinContent: JSON.stringify({ steps: [] }),
    };

    const exit = await Effect.runPromiseExit(
      createWorkflowEffect(validChatroomId, emptyOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('InvalidInput');
    if (error?._tag === 'InvalidInput') {
      expect(error.message).toContain('at least one step');
    }
  });
});

describe('specifyWorkflowStepEffect', () => {
  const validContent = `---GOAL---
Implement the feature
---REQUIREMENTS---
Must pass all tests
---WARNINGS---
Do not break existing clients`;

  const validOptions: SpecifyStepOptions = {
    role: 'planner',
    workflowKey: 'deploy-v1',
    stepKey: 'build',
    assigneeRole: 'builder',
    stdinContent: validContent,
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // parseSections calls process.exit(1) on missing sections — mock it to throw
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid sections and successful mutation', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: undefined }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      specifyWorkflowStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      specifyWorkflowStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
  });

  test('fails with MutationFailed when backend mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Step not found') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      specifyWorkflowStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('MutationFailed');
    if (error?._tag === 'MutationFailed') {
      expect(error.cause.message).toBe('Step not found');
    }
  });

  test('fails with InvalidInput when required sections are missing', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const badOptions: SpecifyStepOptions = {
      ...validOptions,
      stdinContent: '---GOAL---\nSome goal only',
    };

    const exit = await Effect.runPromiseExit(
      specifyWorkflowStepEffect(validChatroomId, badOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('InvalidInput');
  });
});

describe('executeWorkflowEffect', () => {
  const validOptions: ExecuteWorkflowOptions = {
    role: 'planner',
    workflowKey: 'deploy-v1',
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid options and successful mutation', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: undefined }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      executeWorkflowEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      executeWorkflowEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
  });
});

describe('getWorkflowStatusEffect', () => {
  const validOptions: WorkflowStatusOptions = {
    role: 'builder',
    workflowKey: 'deploy-v1',
  };

  const mockWorkflowResult = {
    workflow: {
      workflowKey: 'deploy-v1',
      status: 'active',
      createdBy: 'planner',
      createdAt: Date.now(),
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
    },
    steps: [
      {
        stepKey: 'setup',
        description: 'Initial setup',
        status: 'completed',
        assigneeRole: 'builder',
        dependsOn: [],
        order: 1,
        specification: null,
        cancelReason: null,
      },
    ],
    availableNextSteps: ['build'],
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds and renders workflow when query returns data', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: mockWorkflowResult }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      getWorkflowStatusEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with WorkflowNotFound when query returns null workflow', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: { workflow: null, steps: [], availableNextSteps: [] } }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      getWorkflowStatusEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('WorkflowNotFound');
    if (error?._tag === 'WorkflowNotFound') {
      expect(error.workflowKey).toBe('deploy-v1');
    }
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      getWorkflowStatusEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
  });

  test('fails with QueryFailed when backend query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Database error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      getWorkflowStatusEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('QueryFailed');
    if (error?._tag === 'QueryFailed') {
      expect(error.cause.message).toBe('Database error');
    }
  });
});

describe('completeStepEffect', () => {
  const validOptions: StepCompleteOptions = {
    role: 'builder',
    workflowKey: 'deploy-v1',
    stepKey: 'setup',
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid options and successful mutation', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: undefined }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      completeStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      completeStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
  });
});

describe('exitWorkflowEffect', () => {
  const validOptions: ExitWorkflowOptions = {
    role: 'planner',
    workflowKey: 'deploy-v1',
    reason: 'Scope changed — no longer needed',
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid reason and successful mutation', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: undefined }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      exitWorkflowEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with InvalidInput when reason is empty', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const emptyReasonOptions: ExitWorkflowOptions = { ...validOptions, reason: '   ' };

    const exit = await Effect.runPromiseExit(
      exitWorkflowEffect(validChatroomId, emptyReasonOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('InvalidInput');
    if (error?._tag === 'InvalidInput') {
      expect(error.message).toContain('Reason is required');
    }
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      exitWorkflowEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
  });
});

describe('viewStepEffect', () => {
  const validOptions: ViewStepOptions = {
    role: 'builder',
    workflowKey: 'deploy-v1',
    stepKey: 'build',
  };

  const mockStepResult = {
    workflowKey: 'deploy-v1',
    workflowStatus: 'active',
    step: {
      stepKey: 'build',
      description: 'Build the application',
      status: 'in_progress',
      assigneeRole: 'builder',
      dependsOn: ['setup'],
      order: 2,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      specification: {
        goal: 'Compile and bundle the app',
        requirements: 'All tests must pass',
        warnings: 'Do not skip type checks',
        skills: null,
      },
    },
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds and renders step details when query returns step', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: mockStepResult }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      viewStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with WorkflowNotFound when step is null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        queryResponse: { workflowKey: 'deploy-v1', workflowStatus: 'active', step: null },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      viewStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('WorkflowNotFound');
    if (error?._tag === 'WorkflowNotFound') {
      expect(error.workflowKey).toBe('deploy-v1/build');
    }
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      viewStepEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
  });
});
