/**
 * Direct Harness — Messages Integration Tests
 *
 * Covers: send (frontend), subscribe (frontend), appendMessages (daemon),
 * pendingForMachine (daemon)
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, createSession } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── send ────────────────────────────────────────────────────────────────────

describe('messages.send', () => {
  test('appends a user message and returns seq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-success');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'hello',
    });

    expect(result.seq).toBeGreaterThan(0);
  });

  test('message appears in subscribe', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-visible');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'hello',
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionRowId: rowId,
    });

    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2); // first msg + "hello"
    expect(userMessages[userMessages.length - 1]?.content).toBe('hello');
  });

  test('throws when session is closed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-closed');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionRowId: rowId,
    });

    await expect(
      t.mutation(api.web.directHarness.messages.send, {
        sessionId,
        harnessSessionRowId: rowId,
        text: 'too late',
      })
    ).rejects.toThrow();
  });

  test('throws when message is empty', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-empty');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await expect(
      t.mutation(api.web.directHarness.messages.send, {
        sessionId,
        harnessSessionRowId: rowId,
        text: '',
      })
    ).rejects.toThrow();
  });
});

// ─── subscribe ───────────────────────────────────────────────────────────────

describe('messages.subscribe', () => {
  test('returns all messages without afterSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('sub-all');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'msg1',
    });
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'msg2',
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionRowId: rowId,
    });

    expect(messages.length).toBeGreaterThanOrEqual(3); // first msg + 2 sends
  });

  test('returns only deltas after afterSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('sub-delta');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { seq } = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'before',
    });

    const after = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'after',
    });

    const deltas = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionRowId: rowId,
      afterSeq: seq,
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.content).toBe('after');
  });
});

// ─── appendMessages ──────────────────────────────────────────────────────────

describe('messages.appendMessages', () => {
  test('inserts assistant chunks and returns counts', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-success');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId: rowId,
      chunks: [
        { seq: 1, content: 'Hello', timestamp: 1000 },
        { seq: 2, content: ' world', timestamp: 1001 },
      ],
    });

    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
  });

  test('chunks are stored with role assistant', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-role');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId: rowId,
      chunks: [{ seq: 10, content: 'response', timestamp: 1000 }],
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionRowId: rowId,
    });

    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('response');
  });

  test('idempotent on (sessionId, seq)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-idem');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId: rowId,
      chunks: [{ seq: 1, content: 'first', timestamp: 1000 }],
    });

    const result = await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId: rowId,
      chunks: [
        { seq: 1, content: 'duplicate', timestamp: 1001 },
        { seq: 2, content: 'new', timestamp: 1002 },
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ─── pendingForMachine ───────────────────────────────────────────────────────

describe('messages.pendingForMachine', () => {
  test('returns unprocessed user messages', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'hello',
    });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.every((m) => typeof m.content === 'string')).toBe(true);
  });

  test('does not return messages before lastProcessedSeq', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-cursor');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { seq } = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'before',
    });

    await t.mutation(api.daemon.directHarness.sessions.updateCursor, {
      sessionId,
      harnessSessionRowId: rowId,
      seq,
    });

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionRowId: rowId,
      text: 'after',
    });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe('after');
  });

  test('does not return assistant messages', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-assistant');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Write an assistant response
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId: rowId,
      chunks: [{ seq: 10, content: 'assistant reply', timestamp: 1000 }],
    });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    // Only the initial user message and assistant reply — but assistant shouldn't appear
    const assistantInResult = result.messages.some((m) => m.content === 'assistant reply');
    expect(assistantInResult).toBe(false);
  });
});
