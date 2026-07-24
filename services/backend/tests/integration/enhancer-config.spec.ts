/**
 * enhancer config mutations + queries — Integration Tests
 *
 * Verifies session-based chatroom auth (requireChatroomAccess) and config CRUD.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom } from '../helpers/integration';

describe('web.enhancer.index', () => {
  test('upsertConfig creates config, getConfig returns it', async () => {
    const { sessionId } = await createTestSession('enhancer-upsert');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const upsert = await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
    });
    expect(upsert.configId).toBeDefined();

    const config = await t.query(api.web.enhancer.index.getConfig, {
      sessionId,
      chatroomId,
    });
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(true);
    expect(config!.agentHarness).toBe('opencode');
    expect(config!.model).toBe('anthropic/claude-opus-4');
    expect(config!.machineId).toBe('machine-1');
    expect(config!.targetId).toBe('handoff:planner-to-builder');
  });

  test('upsertConfig updates existing config', async () => {
    const { sessionId } = await createTestSession('enhancer-update');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
    });

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'claude-sdk',
      model: 'anthropic/claude-sonnet-4',
      machineId: 'machine-2',
    });

    const config = await t.query(api.web.enhancer.index.getConfig, {
      sessionId,
      chatroomId,
    });
    expect(config!.agentHarness).toBe('claude-sdk');
    expect(config!.model).toBe('anthropic/claude-sonnet-4');
    expect(config!.machineId).toBe('machine-2');
  });

  test('disableConfig sets enabled false but preserves config', async () => {
    const { sessionId } = await createTestSession('enhancer-disable');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
    });

    const disable = await t.mutation(api.web.enhancer.index.disableConfig, {
      sessionId,
      chatroomId,
    });
    expect(disable.disabled).toBe(true);

    const config = await t.query(api.web.enhancer.index.getConfig, {
      sessionId,
      chatroomId,
    });
    expect(config).not.toBeNull();
    expect(config!.enabled).toBe(false);
    expect(config!.agentHarness).toBe('opencode');
    expect(config!.model).toBe('anthropic/claude-opus-4');
    expect(config!.machineId).toBe('machine-1');
    expect(config!.targetId).toBe('handoff:planner-to-builder');
  });

  test('re-enable after disable restores enabled without losing config', async () => {
    const { sessionId } = await createTestSession('enhancer-re-enable');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
    });

    await t.mutation(api.web.enhancer.index.disableConfig, { sessionId, chatroomId });

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
    });

    const config = await t.query(api.web.enhancer.index.getConfig, {
      sessionId,
      chatroomId,
    });
    expect(config!.enabled).toBe(true);
    expect(config!.agentHarness).toBe('opencode');
    expect(config!.model).toBe('anthropic/claude-opus-4');
    expect(config!.machineId).toBe('machine-1');
  });

  test('per-user isolation: two users in their own chatrooms have independent configs', async () => {
    const { sessionId: sessionA } = await createTestSession('enhancer-userA');
    const { sessionId: sessionB } = await createTestSession('enhancer-userB');
    const chatroomA = await createDuoTeamChatroom(sessionA);
    const chatroomB = await createDuoTeamChatroom(sessionB);

    // User A creates config
    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId: sessionA,
      chatroomId: chatroomA,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
    });

    // User B has no config in their own chatroom
    const configB = await t.query(api.web.enhancer.index.getConfig, {
      sessionId: sessionB,
      chatroomId: chatroomB,
    });
    expect(configB).toBeNull();

    // User A has their config
    const configA = await t.query(api.web.enhancer.index.getConfig, {
      sessionId: sessionA,
      chatroomId: chatroomA,
    });
    expect(configA).toBeDefined();

    // User B cannot see user A's config (access denied)
    await expect(
      t.query(api.web.enhancer.index.getConfig, {
        sessionId: sessionB,
        chatroomId: chatroomA,
      })
    ).rejects.toThrow(/Access denied/);
  });

  test('rejects when model is empty', async () => {
    const { sessionId } = await createTestSession('enhancer-empty-model');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.mutation(api.web.enhancer.index.upsertConfig, {
        sessionId,
        chatroomId,
        enabled: true,
        targetId: 'handoff:planner-to-builder',
        agentHarness: 'opencode',
        model: '',
        machineId: 'machine-1',
      })
    ).rejects.toThrow(/model must not be empty/);
  });

  test('rejects when machineId is empty', async () => {
    const { sessionId } = await createTestSession('enhancer-empty-mid');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.mutation(api.web.enhancer.index.upsertConfig, {
        sessionId,
        chatroomId,
        enabled: true,
        targetId: 'handoff:planner-to-builder',
        agentHarness: 'opencode',
        model: 'anthropic/claude-opus-4',
        machineId: '',
      })
    ).rejects.toThrow(/machineId must not be empty/);
  });
});
