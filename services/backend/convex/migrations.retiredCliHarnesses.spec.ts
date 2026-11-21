/**
 * Migration: purgeRetiredCliHarness*
 *
 * Deletes or repairs stored rows that still reference the retired CLI harnesses
 * (`opencode`, `pi`, `cursor`, `claude`, `copilot`, `commandcode`). Each
 * migration is idempotent and skips rows without a retired harness.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { beforeAll, describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';

let owner: Doc<'users'>;

beforeAll(async () => {
  const sessionId = 'migration-retired-cli-harnesses' as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const user = await t.run((ctx) => ctx.db.query('users').first());
  if (!user) throw new Error('owner user not found');
  owner = user;
});

function insertRoom(name: string) {
  return t.run((ctx) =>
    ctx.db.insert('chatroom_rooms', { status: 'active', ownerId: owner._id, name })
  );
}

describe('migrations: retired CLI harness purge', () => {
  test('deletes model filters saved for a retired CLI harness', async () => {
    const machineId = 'purge-cli-model-filters';
    const { retiredId, sdkId } = await t.run(async (ctx) => ({
      retiredId: await ctx.db.insert('chatroom_machineModelFilters', {
        machineId,
        agentHarness: 'opencode',
        hiddenModels: ['m/a'],
        hiddenProviders: [],
        updatedAt: 1,
      }),
      sdkId: await ctx.db.insert('chatroom_machineModelFilters', {
        machineId,
        agentHarness: 'claude-sdk',
        hiddenModels: ['m/b'],
        hiddenProviders: ['p'],
        updatedAt: 2,
      }),
    }));
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessModelFilters, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      retired: await ctx.db.get(retiredId),
      sdk: await ctx.db.get(sdkId),
    }));
    expect(after.retired).toBeNull();
    expect(after.sdk).toEqual(sdkBefore);
  });

  test('deletes launch requests for a retired CLI harness', async () => {
    const chatroomId = await insertRoom('purge-cli-launch-requests');
    const machineId = 'purge-cli-launch-requests';
    const base = {
      chatroomId,
      teamStructureId: 'ts-1',
      role: 'builder',
      agentType: 'remote',
      machineId,
      model: 'm',
      workingDir: '/tmp/ws',
      reason: 'test',
      wantResume: false,
      requestedBy: owner._id,
      requestedAt: 1,
    } as const;
    const { retiredId, sdkId } = await t.run(async (ctx) => ({
      retiredId: await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        ...base,
        requestKey: 'retired-key',
        requestId: 'retired-request',
        commandId: 'retired-command',
        agentHarness: 'opencode',
      }),
      sdkId: await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        ...base,
        requestKey: 'sdk-key',
        requestId: 'sdk-request',
        commandId: 'sdk-command',
        agentHarness: 'claude-sdk',
      }),
    }));
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessLaunchRequests, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      retired: await ctx.db.get(retiredId),
      sdk: await ctx.db.get(sdkId),
    }));
    expect(after.retired).toBeNull();
    expect(after.sdk).toEqual(sdkBefore);
  });

  test('drops retired entries from machine config favorites', async () => {
    const mixedMachineId = 'purge-cli-favorites-mixed';
    const allRetiredMachineId = 'purge-cli-favorites-all-retired';
    const sdkMachineId = 'purge-cli-favorites-sdk';
    const { mixedId, allRetiredId, sdkId } = await t.run(async (ctx) => ({
      mixedId: await ctx.db.insert('chatroom_machineConfigFavorites', {
        userId: owner._id,
        machineId: mixedMachineId,
        teamRoleKey: 'team_a#role_builder',
        favorites: [
          { agentHarness: 'opencode', model: 'x/1' },
          { agentHarness: 'claude-sdk', model: 'y/2' },
        ],
        updatedAt: 1,
      }),
      allRetiredId: await ctx.db.insert('chatroom_machineConfigFavorites', {
        userId: owner._id,
        machineId: allRetiredMachineId,
        teamRoleKey: 'team_a#role_reviewer',
        favorites: [{ agentHarness: 'pi', model: 'p/1' }],
        updatedAt: 2,
      }),
      sdkId: await ctx.db.insert('chatroom_machineConfigFavorites', {
        userId: owner._id,
        machineId: sdkMachineId,
        teamRoleKey: 'team_a#role_builder',
        favorites: [{ agentHarness: 'codex-sdk', model: 'z/3' }],
        updatedAt: 3,
      }),
    }));
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessFavorites, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      mixed: await ctx.db.get(mixedId),
      allRetired: await ctx.db.get(allRetiredId),
      sdk: await ctx.db.get(sdkId),
    }));
    expect(after.mixed!.favorites).toEqual([{ agentHarness: 'claude-sdk', model: 'y/2' }]);
    expect(after.allRetired!.favorites).toEqual([]);
    expect(after.sdk).toEqual(sdkBefore);
  });

  test('drops retired harnesses from the machine capability snapshot', async () => {
    const retiredMachineId = 'purge-cli-capabilities-retired';
    const sdkMachineId = 'purge-cli-capabilities-sdk';
    const { retiredId, sdkId } = await t.run(async (ctx) => ({
      retiredId: await ctx.db.insert('chatroom_machineCapabilities', {
        machineId: retiredMachineId,
        lastSeenAt: 1_700_000_000_000,
        availableHarnesses: ['opencode', 'claude-sdk'],
        harnessVersions: {
          opencode: { version: '1.2.3', major: 1 },
          'claude-sdk': { version: '2.0.0', major: 2 },
        },
        workspaces: [],
        updatedAt: 1_650_000_000_000,
      }),
      sdkId: await ctx.db.insert('chatroom_machineCapabilities', {
        machineId: sdkMachineId,
        lastSeenAt: 1_700_000_000_000,
        availableHarnesses: ['codex-sdk'],
        harnessVersions: { 'codex-sdk': { version: '0.1.0', major: 0 } },
        workspaces: [],
        updatedAt: 1_650_000_000_000,
      }),
    }));
    const retiredBefore = await t.run((ctx) => ctx.db.get(retiredId));
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessCapabilities, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      retired: await ctx.db.get(retiredId),
      sdk: await ctx.db.get(sdkId),
    }));
    expect(after.retired).toEqual({
      ...retiredBefore!,
      availableHarnesses: ['claude-sdk'],
      harnessVersions: { 'claude-sdk': { version: '2.0.0', major: 2 } },
    });
    expect(after.sdk).toEqual(sdkBefore);
  });

  test('deletes queued launch and restart commands for a retired CLI harness', async () => {
    const chatroomId = await insertRoom('purge-cli-command-inbox');
    const machineId = 'purge-cli-command-inbox';
    const { requestStartId, restartId, sdkId, stopId } = await t.run(async (ctx) => ({
      requestStartId: await ctx.db.insert('chatroom_machineCommandInbox', {
        machineId,
        command: {
          type: 'agent.requestStart',
          requestId: 'req-1',
          chatroomId,
          role: 'builder',
          agentHarness: 'opencode',
          model: 'm',
          workingDir: '/tmp/ws',
          reason: 'test',
          wantResume: false,
        },
        createdAt: 1,
        deadline: 2,
        attemptCount: 0,
        status: 'pending',
      }),
      restartId: await ctx.db.insert('chatroom_machineCommandInbox', {
        machineId,
        command: {
          type: 'agent.restart',
          requestId: 'req-2',
          chatroomId,
          role: 'builder',
          agentHarness: 'opencode',
          model: 'm',
          workingDir: '/tmp/ws',
          correlationId: 'corr-1',
          wantResume: false,
        },
        createdAt: 1,
        deadline: 2,
        attemptCount: 0,
        status: 'pending',
      }),
      sdkId: await ctx.db.insert('chatroom_machineCommandInbox', {
        machineId,
        command: {
          type: 'agent.requestStart',
          requestId: 'req-3',
          chatroomId,
          role: 'builder',
          agentHarness: 'claude-sdk',
          model: 'm',
          workingDir: '/tmp/ws',
          reason: 'test',
          wantResume: false,
        },
        createdAt: 1,
        deadline: 2,
        attemptCount: 0,
        status: 'pending',
      }),
      stopId: await ctx.db.insert('chatroom_machineCommandInbox', {
        machineId,
        command: { type: 'agent.stop', chatroomId },
        createdAt: 1,
        deadline: 2,
        attemptCount: 0,
        status: 'pending',
      }),
    }));
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));
    const stopBefore = await t.run((ctx) => ctx.db.get(stopId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessCommandInbox, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      requestStart: await ctx.db.get(requestStartId),
      restart: await ctx.db.get(restartId),
      sdk: await ctx.db.get(sdkId),
      stop: await ctx.db.get(stopId),
    }));
    expect(after.requestStart).toBeNull();
    expect(after.restart).toBeNull();
    expect(after.sdk).toEqual(sdkBefore);
    expect(after.stop).toEqual(stopBefore);
  });

  test('deletes deprecated desired configs for a retired CLI harness', async () => {
    const chatroomId = await insertRoom('purge-cli-desired-configs');
    const { retiredId, sdkId } = await t.run(async (ctx) => ({
      retiredId: await ctx.db.insert('chatroom_agentDesiredConfigs', {
        teamRoleKey: 'team_a#role_builder',
        chatroomId,
        role: 'builder',
        type: 'remote',
        agentHarness: 'opencode',
        createdAt: 1,
        updatedAt: 1,
      }),
      sdkId: await ctx.db.insert('chatroom_agentDesiredConfigs', {
        teamRoleKey: 'team_a#role_reviewer',
        chatroomId,
        role: 'reviewer',
        type: 'remote',
        agentHarness: 'claude-sdk',
        createdAt: 1,
        updatedAt: 1,
      }),
    }));
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessDesiredConfigs, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      retired: await ctx.db.get(retiredId),
      sdk: await ctx.db.get(sdkId),
    }));
    expect(after.retired).toBeNull();
    expect(after.sdk).toEqual(sdkBefore);
  });

  test('deletes deprecated runtime states for a retired CLI harness', async () => {
    const chatroomId = await insertRoom('purge-cli-runtime-states');
    const { retiredId, sdkId } = await t.run(async (ctx) => {
      const retiredConfigId = await ctx.db.insert('chatroom_agentDesiredConfigs', {
        teamRoleKey: 'team_a#role_builder',
        chatroomId,
        role: 'builder',
        type: 'remote',
        agentHarness: 'opencode',
        createdAt: 1,
        updatedAt: 1,
      });
      const sdkConfigId = await ctx.db.insert('chatroom_agentDesiredConfigs', {
        teamRoleKey: 'team_a#role_reviewer',
        chatroomId,
        role: 'reviewer',
        type: 'remote',
        agentHarness: 'claude-sdk',
        createdAt: 1,
        updatedAt: 1,
      });
      return {
        retiredId: await ctx.db.insert('chatroom_agentRuntimeStates', {
          desiredConfigId: retiredConfigId,
          chatroomId,
          role: 'builder',
          status: 'offline',
          actualHarness: 'opencode',
          updatedAt: 1,
        }),
        sdkId: await ctx.db.insert('chatroom_agentRuntimeStates', {
          desiredConfigId: sdkConfigId,
          chatroomId,
          role: 'reviewer',
          status: 'offline',
          actualHarness: 'claude-sdk',
          updatedAt: 1,
        }),
      };
    });
    const sdkBefore = await t.run((ctx) => ctx.db.get(sdkId));

    await t.mutation(internal.migrations.purgeRetiredCliHarnessRuntimeStates, {
      cursor: null,
      batchSize: 100,
      reset: true,
    });

    const after = await t.run(async (ctx) => ({
      retired: await ctx.db.get(retiredId),
      sdk: await ctx.db.get(sdkId),
    }));
    expect(after.retired).toBeNull();
    expect(after.sdk).toEqual(sdkBefore);
  });

  test('is idempotent: a second run over all seven tables changes nothing', async () => {
    const chatroomId = await insertRoom('purge-cli-idempotent');
    const machineId = 'purge-cli-idempotent';
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineModelFilters', {
        machineId,
        agentHarness: 'opencode',
        hiddenModels: ['m/a'],
        hiddenProviders: [],
        updatedAt: 1,
      });
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: 'idempotent-key',
        requestId: 'idempotent-request',
        commandId: 'idempotent-command',
        chatroomId,
        teamStructureId: 'ts-1',
        role: 'builder',
        agentType: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp/ws',
        reason: 'test',
        wantResume: false,
        requestedBy: owner._id,
        requestedAt: 1,
      });
      await ctx.db.insert('chatroom_machineConfigFavorites', {
        userId: owner._id,
        machineId,
        teamRoleKey: 'team_a#role_builder',
        favorites: [{ agentHarness: 'opencode', model: 'x/1' }],
        updatedAt: 1,
      });
      await ctx.db.insert('chatroom_machineCapabilities', {
        machineId,
        lastSeenAt: 1_700_000_000_000,
        availableHarnesses: ['opencode'],
        harnessVersions: { opencode: { version: '1.2.3', major: 1 } },
        workspaces: [],
        updatedAt: 1_650_000_000_000,
      });
      await ctx.db.insert('chatroom_machineCommandInbox', {
        machineId,
        command: {
          type: 'agent.requestStart',
          requestId: 'req-1',
          chatroomId,
          role: 'builder',
          agentHarness: 'opencode',
          model: 'm',
          workingDir: '/tmp/ws',
          reason: 'test',
          wantResume: false,
        },
        createdAt: 1,
        deadline: 2,
        attemptCount: 0,
        status: 'pending',
      });
      const configId = await ctx.db.insert('chatroom_agentDesiredConfigs', {
        teamRoleKey: 'team_a#role_builder',
        chatroomId,
        role: 'builder',
        type: 'remote',
        agentHarness: 'opencode',
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert('chatroom_agentRuntimeStates', {
        desiredConfigId: configId,
        chatroomId,
        role: 'builder',
        status: 'offline',
        actualHarness: 'opencode',
        updatedAt: 1,
      });
    });

    const runAll = async () => {
      await t.mutation(internal.migrations.purgeRetiredCliHarnessModelFilters, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
      await t.mutation(internal.migrations.purgeRetiredCliHarnessLaunchRequests, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
      await t.mutation(internal.migrations.purgeRetiredCliHarnessFavorites, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
      await t.mutation(internal.migrations.purgeRetiredCliHarnessCapabilities, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
      await t.mutation(internal.migrations.purgeRetiredCliHarnessCommandInbox, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
      await t.mutation(internal.migrations.purgeRetiredCliHarnessDesiredConfigs, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
      await t.mutation(internal.migrations.purgeRetiredCliHarnessRuntimeStates, {
        cursor: null,
        batchSize: 100,
        reset: true,
      });
    };

    const snapshot = () =>
      t.run(async (ctx) => ({
        modelFilters: await ctx.db.query('chatroom_machineModelFilters').collect(),
        launchRequests: await ctx.db.query('chatroom_agentLastSentLaunchRequests').collect(),
        favorites: await ctx.db.query('chatroom_machineConfigFavorites').collect(),
        capabilities: await ctx.db.query('chatroom_machineCapabilities').collect(),
        commandInbox: await ctx.db.query('chatroom_machineCommandInbox').collect(),
        desiredConfigs: await ctx.db.query('chatroom_agentDesiredConfigs').collect(),
        runtimeStates: await ctx.db.query('chatroom_agentRuntimeStates').collect(),
      }));

    await runAll();
    const first = await snapshot();
    await runAll();
    const second = await snapshot();
    expect(second).toEqual(first);
  });

  test('registers the purge migrations before backfillActiveTaskHeaders', async () => {
    const statuses = await t.query(api.migrations.getRunAllStatus, {});
    const names = statuses.map((status) => status.name);
    const indexOf = (suffix: string) => names.findIndex((name) => name.endsWith(suffix));

    const backfillIndex = indexOf('backfillActiveTaskHeaders');
    expect(backfillIndex).toBeGreaterThan(-1);
    for (const name of [
      'purgeRetiredCliHarnessModelFilters',
      'purgeRetiredCliHarnessLaunchRequests',
      'purgeRetiredCliHarnessFavorites',
      'purgeRetiredCliHarnessCapabilities',
      'purgeRetiredCliHarnessCommandInbox',
      'purgeRetiredCliHarnessDesiredConfigs',
      'purgeRetiredCliHarnessRuntimeStates',
    ]) {
      const index = indexOf(name);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(backfillIndex);
    }
  });
});
