import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { AgentStartReasonCode } from '../../entities/agent';

let n = 0;

async function setup() {
  const sessionId = `lifecycle-fact-${++n}` as SessionId;
  const machineId = `lifecycle-fact-machine-${n}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return { sessionId, machineId, chatroomId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

// The status branch only projects for a role whose last-sent launch request is
// owned by the reporting machine; without one it returns `not_configured`.
async function recordLaunchRequestFor(s: Setup, role: string) {
  await t.run(async (ctx) => {
    const user = await ctx.db.query('users').first();
    await recordLastSentLaunchRequest(ctx, {
      requestId: `lifecycle-request-${role}`,
      commandId: `lifecycle-command-${role}`,
      chatroomId: s.chatroomId,
      teamStructureId: 'duo@1',
      role,
      agentType: 'remote',
      machineId: s.machineId,
      agentHarness: 'opencode',
      model: 'test',
      workingDir: '/tmp',
      reason: AgentStartReasonCode.USER_START,
      wantResume: false,
      requestedBy: user!._id,
      requestedAt: Date.now(),
    });
  });
}

function rowFor(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .first()
  );
}

describe('projectAgentLifecycleFact status branch', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('an applied status fact is not skipped and stays silent', async () => {
    const s = await setup();
    await recordLaunchRequestFor(s, 'builder');

    const seeded = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'builder',
        status: 'waiting' as const,
        revisionKey: 'status:200',
        emittedAt: 200,
      },
    });

    expect(seeded).toMatchObject({ success: true, skipped: false });
    expect(seeded.rejectionReason).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    const applied = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'builder',
        status: 'error' as const,
        errorSource: 'runtime' as const,
        errorCode: 'daemon.status',
        errorMessage: 'boom',
        revisionKey: 'status:300',
        emittedAt: 300,
      },
    });

    expect(applied).toMatchObject({ success: true, skipped: false });
    expect(applied.rejectionReason).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect((await rowFor(s.chatroomId, 'builder'))?.status).toBe('error');
  });

  test('a stale error fact reports stale_event and warns', async () => {
    const s = await setup();
    await recordLaunchRequestFor(s, 'builder');

    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'builder',
        status: 'waiting' as const,
        revisionKey: 'status:200',
        emittedAt: 200,
      },
    });

    const result = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'builder',
        status: 'error' as const,
        errorSource: 'runtime' as const,
        errorCode: 'daemon.status',
        errorMessage: 'boom',
        revisionKey: 'status:100',
        emittedAt: 100,
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      rejectionReason: 'stale_event',
    });
    expect((await rowFor(s.chatroomId, 'builder'))?.status).toBe('waiting');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a stale heartbeat-class fact reports stale_event without warning', async () => {
    const s = await setup();
    await recordLaunchRequestFor(s, 'builder');

    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'builder',
        status: 'waiting' as const,
        revisionKey: 'status:200',
        emittedAt: 200,
      },
    });

    const result = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'builder',
        status: 'working' as const,
        revisionKey: 'status:100',
        emittedAt: 100,
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      rejectionReason: 'stale_event',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a role without a launch request keeps reporting not_configured', async () => {
    const s = await setup();

    const result = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: s.sessionId,
      machineId: s.machineId,
      fact: {
        kind: 'status' as const,
        chatroomId: s.chatroomId,
        role: 'planner',
        status: 'error' as const,
        errorSource: 'runtime' as const,
        errorCode: 'daemon.status',
        errorMessage: 'boom',
        revisionKey: 'status:100',
        emittedAt: 100,
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      rejectionReason: 'not_configured',
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
