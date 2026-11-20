/**
 * chatrooms.createManyWithWorkspace — Integration Tests
 *
 * Covers the public bulk-create boundary end to end: the owner check runs once for the whole
 * batch, the batch cap rejects before any write, repeated calls skip, and the wrapper never
 * starts an agent. Per-item logic is covered by the use case spec.
 */

import { describe, expect, test } from 'vitest';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];

async function setup(key: string) {
  const { sessionId } = await createTestSession(`bulk-mutation-${key}`);
  const machineId = `machine-bulk-mutation-${key}`;
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

function createMany(sessionId: SessionId, machineId: string, workingDirs: string[]) {
  return t.mutation(api.chatrooms.createManyWithWorkspace, { sessionId, machineId, workingDirs });
}

const chatroomRows = () => t.run((ctx) => ctx.db.query('chatroom_rooms').collect());

describe('chatrooms.createManyWithWorkspace', () => {
  test('creates via the mutation, returns the batch counts, and skips on a repeat call', async () => {
    const { sessionId, machineId } = await setup('counts');

    const first = await createMany(sessionId, machineId, ['/work/repo-1', '/work/repo-2']);

    expect(first.created).toBe(2);
    expect(first.skipped).toBe(0);
    expect(first.failed).toBe(0);
    expect(first.results).toHaveLength(2);

    const second = await createMany(sessionId, machineId, ['/work/repo-1', '/work/repo-2']);

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.results).toHaveLength(2);
  });

  test('a caller who does not own the machine creates nothing', async () => {
    const { machineId } = await setup('owner');
    const { sessionId: otherSessionId } = await createTestSession('bulk-mutation-owner-other');
    const before = (await chatroomRows()).length;

    await expect(createMany(otherSessionId, machineId, ['/work/repo-1'])).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE },
    });

    expect((await chatroomRows()).length).toBe(before);
  });

  test('more than 50 dirs is rejected by the mutation and writes nothing', async () => {
    const { sessionId, machineId } = await setup('cap');
    const dirs = Array.from({ length: 51 }, (_, index) => `/work/over-${index + 1}`);
    const before = (await chatroomRows()).length;

    await expect(createMany(sessionId, machineId, dirs)).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.BULK_CREATE_LIMIT_EXCEEDED },
    });

    expect((await chatroomRows()).length).toBe(before);
  });

  test('no agent is started by the mutation', async () => {
    const { sessionId, machineId } = await setup('no-agent');

    await createMany(sessionId, machineId, ['/work/repo-1']);

    const inbox = await getInboxCommandsForMachine(machineId);
    expect(inbox.filter((row) => row.command.type === 'agent.requestStart')).toHaveLength(0);
  });

  test('a one-element array matches the single path result shape', async () => {
    const { sessionId, machineId } = await setup('single');

    const result = await createMany(sessionId, machineId, ['/work/single-path']);

    expect(result.created).toBe(1);
    expect(result.results[0]).toMatchObject({
      outcome: 'created',
      workingDir: '/work/single-path',
    });
  });
});
