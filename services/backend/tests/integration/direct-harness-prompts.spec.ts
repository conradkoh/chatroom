/**
 * Direct Harness — Prompts Integration Tests
 *
 * Covers: submitPrompt, claimNextPendingPrompt, completePendingPrompt, resumeSession.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, openSession } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── submitPrompt ─────────────────────────────────────────────────────────────

describe('submitPrompt', () => {
  test('inserts a pending prompt row and returns promptId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('submit-success');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const result = await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'hello' }],
      override: { agent: 'builder' },
    });

    expect(result.promptId).toBeDefined();
  });

  test('throws when session is closed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('submit-closed');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionRowId,
    });

    await expect(
      t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
        sessionId,
        harnessSessionRowId,
        parts: [{ type: 'text' as const, text: 'too late' }],
        override: { agent: 'builder' },
      })
    ).rejects.toThrow();
  });
});

// ─── claimNextPendingPrompt ───────────────────────────────────────────────────

describe('claimNextPendingPrompt', () => {
  test('returns null when no pending prompts exist', async () => {
    const { sessionId, machineId } = await setupWorkspaceForSession('claim-empty');

    const result = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });

    expect(result).toBeNull();
  });

  test('claims oldest prompt first (FIFO) when multiple pending exist', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('claim-atomic');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'first' }],
      override: { agent: 'builder' },
    });
    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'second' }],
      override: { agent: 'builder' },
    });

    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('processing');

    const claimed2 = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed2).not.toBeNull();

    const claimed3 = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed3).not.toBeNull();

    const claimed4 = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed4).toBeNull();
  });
});

// ─── completePendingPrompt ────────────────────────────────────────────────────

describe('completePendingPrompt', () => {
  test('updates status to done', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('complete-done');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'hello' }],
      override: { agent: 'builder' },
    });

    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed).not.toBeNull();

    await t.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: claimed!._id,
      status: 'done',
    });

    const queue = await t.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      sessionId,
      harnessSessionRowId,
    });
    expect(queue[0]?.status).toBe('done');
  });

  test('updates status to error with message', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('complete-error');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'oops' }],
      override: { agent: 'builder' },
    });

    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });

    await t.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: claimed!._id,
      status: 'error',
      errorMessage: 'connection reset',
    });

    const queue = await t.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      sessionId,
      harnessSessionRowId,
    });
    expect(queue[0]?.status).toBe('error');
    expect(queue[0]?.errorMessage).toBe('connection reset');
  });
});

// ─── completePendingPrompt — cross-machine rejection ─────────────────────────

test('rejects when prompt belongs to a different machine', async () => {
  const { sessionId, workspaceId, machineId } =
    await setupWorkspaceForSession('complete-cross-machine');
  const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

  await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
    sessionId,
    harnessSessionRowId,
    parts: [{ type: 'text' as const, text: 'hello' }],
    override: { agent: 'builder' },
  });

  const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
    sessionId,
    machineId,
  });
  expect(claimed).not.toBeNull();

  const otherMachineId = 'other-machine-for-cross';
  await t.mutation(api.machines.register, {
    sessionId,
    machineId: otherMachineId,
    hostname: 'other-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    availableModels: {},
  });

  await expect(
    t.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId: otherMachineId,
      promptId: claimed!._id,
      status: 'done',
    })
  ).rejects.toThrow('Prompt does not belong to this machine');
});

// ─── resumeSession ────────────────────────────────────────────────────────────

describe('resumeSession', () => {
  test('enqueues a resume task for an active session', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('resume-enqueue');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'sdk-session-xyz',
    });

    const result = await t.mutation(api.chatroom.directHarness.prompts.resumeSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(result.promptId).toBeDefined();

    const queue = await t.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      sessionId,
      harnessSessionRowId,
    });
    const resumeTask = queue.find((q) => (q as any).taskType === 'resume');
    expect(resumeTask).toBeDefined();
    expect((resumeTask as any).parts).toHaveLength(0);
  });

  test('throws when session is in pending/spawning state', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('resume-pending');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await expect(
      t.mutation(api.chatroom.directHarness.prompts.resumeSession, {
        sessionId,
        harnessSessionRowId,
      })
    ).rejects.toThrow('still starting');
  });

  test('allows resuming a closed session (daemon will try and fail gracefully if harness gone)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('resume-closed');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionRowId,
    });

    const result = await t.mutation(api.chatroom.directHarness.prompts.resumeSession, {
      sessionId,
      harnessSessionRowId,
    });
    expect(result.promptId).toBeDefined();
  });
});
