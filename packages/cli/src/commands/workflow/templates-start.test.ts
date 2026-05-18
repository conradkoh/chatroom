/**
 * Workflow Template Start Unit Tests
 *
 * Tests for startWorkflowFromTemplate — creating workflows from
 * built-in templates (e.g. code-review).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startWorkflowFromTemplate } from './index.js';
import type { WorkflowDeps } from './deps.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let exitSpy: any;
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockDeps(overrides?: Partial<WorkflowDeps>): WorkflowDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({ workflowId: 'test-wf-id' }),
      query: vi.fn(),
    },
    session: {
      getSessionId: vi.fn().mockResolvedValue('test-session-id'),
      getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startWorkflowFromTemplate', () => {
  it('exits with error for unknown template', async () => {
    const deps = createMockDeps();

    await expect(
      startWorkflowFromTemplate(
        'test-chatroom-id-12345678901234567890',
        { role: 'planner', template: 'nonexistent' },
        deps
      )
    ).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown template')
    );
  });

  it('creates code-review workflow with 8 steps', async () => {
    const mutationSpy = vi.fn();
    // Return values for: createWorkflow, specifyStep (8x), executeWorkflow
    mutationSpy
      .mockResolvedValueOnce({ workflowId: 'test-wf-id' }) // createWorkflow
      .mockResolvedValue(undefined); // specifyStep + executeWorkflow (default)
    
    const deps = createMockDeps({
      backend: {
        mutation: mutationSpy,
        query: vi.fn(),
      },
    });

    await startWorkflowFromTemplate(
      'test-chatroom-id-12345678901234567890',
      { role: 'planner', template: 'code-review' },
      deps
    );

    // Should have called: createWorkflow (1) + specifyStep (8) + executeWorkflow (1) = 10
    expect(mutationSpy).toHaveBeenCalledTimes(10);

    // First call: createWorkflow
    const createCall = mutationSpy.mock.calls[0];
    const createArgs = createCall[1];
    expect(createArgs.steps.length).toBe(8);
    expect(createArgs.workflowKey).toMatch(/^code-review-\d+$/);
    expect(createArgs.createdBy).toBe('planner');

    // Should have called create, specify x8, execute = 10 total
    expect(mutationSpy).toHaveBeenCalledTimes(10);
  });

  it('specifies each step with its assignee role', async () => {
    const mutationSpy = vi.fn();
    mutationSpy
      .mockResolvedValueOnce({ workflowId: 'test-wf-id' }) // createWorkflow
      .mockResolvedValue(undefined); // everything else

    const deps = createMockDeps({
      backend: {
        mutation: mutationSpy,
        query: vi.fn(),
      },
    });

    await startWorkflowFromTemplate(
      'test-chatroom-id-12345678901234567890',
      { role: 'reviewer', template: 'code-review' },
      deps
    );

    // Check that all specifyStep calls use the reviewer role as assignee
    for (let i = 1; i <= 8; i++) {
      const specifyCall = mutationSpy.mock.calls[i];
      const specifyArgs = specifyCall[1];
      expect(specifyArgs.assigneeRole).toBe('reviewer');
      expect(specifyArgs.goal).toBeTruthy();
      expect(specifyArgs.requirements).toBeTruthy();
    }
  });

  it('exits with error when auth fails', async () => {
    const deps = createMockDeps({
      session: {
        getSessionId: vi.fn().mockResolvedValue(null),
        getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
        getOtherSessionUrls: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(
      startWorkflowFromTemplate(
        'test-chatroom-id-12345678901234567890',
        { role: 'planner', template: 'code-review' },
        deps
      )
    ).rejects.toThrow('process.exit called');
  });
});
