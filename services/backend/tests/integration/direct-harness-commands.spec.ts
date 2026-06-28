/**
 * Direct Harness — Web command integration tests.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createSession, setupWorkspaceForSession } from './direct-harness/fixtures';

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

describe('web.directHarness.commands.closeSession', () => {
  test('enqueues a closeSession command for an active session', async () => {
    const { sessionId, machineId, workspaceId } =
      await setupWorkspaceForSession('close-cmd-enqueue');
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.commands.closeSession, {
      sessionId,
      harnessSessionId,
    });

    const pending = await t.query(api.daemon.directHarness.commands.listPendingCommands, {
      sessionId,
      machineId,
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe('closeSession');
    expect(pending[0]?.closeSession?.harnessSessionId).toBe(harnessSessionId);
  });

  test('deduplicates pending closeSession commands for the same session', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('close-cmd-dedup');
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.commands.closeSession, {
      sessionId,
      harnessSessionId,
    });
    await t.mutation(api.web.directHarness.commands.closeSession, {
      sessionId,
      harnessSessionId,
    });

    const pending = await t.query(api.daemon.directHarness.commands.listPendingCommands, {
      sessionId,
      machineId,
    });

    expect(pending).toHaveLength(1);
  });

  test('no-ops for already closed sessions', async () => {
    const { sessionId, machineId, workspaceId } =
      await setupWorkspaceForSession('close-cmd-terminal');
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionId,
    });

    await t.mutation(api.web.directHarness.commands.closeSession, {
      sessionId,
      harnessSessionId,
    });

    const pending = await t.query(api.daemon.directHarness.commands.listPendingCommands, {
      sessionId,
      machineId,
    });

    expect(pending).toHaveLength(0);
  });

  test('allows close for pending sessions before daemon associates opencodeSessionId', async () => {
    const { sessionId, machineId, workspaceId } =
      await setupWorkspaceForSession('close-cmd-pending');
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.commands.closeSession, {
      sessionId,
      harnessSessionId: harnessSessionId as Id<'chatroom_harnessSessions'>,
    });

    const pending = await t.query(api.daemon.directHarness.commands.listPendingCommands, {
      sessionId,
      machineId,
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe('closeSession');
  });
});
