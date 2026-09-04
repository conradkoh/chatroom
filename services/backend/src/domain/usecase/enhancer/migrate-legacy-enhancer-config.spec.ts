import { describe, expect, test } from 'vitest';

import {
  mergeCanonicalEnhancerIntoTeamRoles,
  migrateEnhancerConfigRow,
} from './migrate-legacy-enhancer-config';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('legacy enhancer migration helpers', () => {
  test('adds enhancer to legacy duo and solo presets', () => {
    expect(mergeCanonicalEnhancerIntoTeamRoles('duo', ['planner', 'builder'])).toEqual([
      'planner',
      'enhancer',
      'builder',
    ]);
    expect(mergeCanonicalEnhancerIntoTeamRoles('solo', ['solo'])).toEqual([
      'solo',
      'enhancer',
      'builder',
    ]);
  });

  test('preserves existing enhancer and custom teams', () => {
    expect(mergeCanonicalEnhancerIntoTeamRoles('duo', ['planner', 'enhancer', 'builder'])).toEqual([
      'planner',
      'enhancer',
      'builder',
    ]);
    expect(mergeCanonicalEnhancerIntoTeamRoles('custom', ['planner', 'builder'])).toEqual([
      'planner',
      'builder',
    ]);
  });

  test('creates an incomplete disabled config when no working directory resolves', async () => {
    const sessionId = 'enhancer-migration-incomplete' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'enhancer-migration-machine';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
    const room = await t.run((ctx) => ctx.db.get(chatroomId));
    const legacyId = await t.run((ctx) =>
      ctx.db.insert('chatroom_enhancerConfigs', {
        chatroomId,
        userId: room!.ownerId,
        enabled: true,
        targetId: 'handoff:planner-to-builder',
        agentHarness: 'opencode',
        model: 'test',
        machineId,
        updatedAt: Date.now(),
      })
    );
    await t.run((ctx) =>
      migrateEnhancerConfigRow(ctx, {
        ...(undefined as never),
        _id: legacyId,
        _creationTime: 0,
        chatroomId,
        userId: room!.ownerId,
        enabled: true,
        targetId: 'handoff:planner-to-builder',
        agentHarness: 'opencode',
        model: 'test',
        machineId,
        updatedAt: Date.now(),
      })
    );
    const config = await t.run((ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'enhancer'))
        )
        .first()
    );
    expect(config?.enabled).toBe(false);
    expect(config?.workingDir).toBeUndefined();
  });
});
