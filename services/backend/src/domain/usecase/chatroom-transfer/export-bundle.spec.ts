/**
 * Chatroom export bundle — order, checksum pairing, retry and all-or-nothing.
 *
 * The happy path runs `runExportBundle` through the convex-test port, so paging,
 * consistency, the build and both checksums are the real implementation. The
 * failure paths substitute the port (the seam the driver owns) to make one
 * chatroom fail deterministically: a page read that throws models a transient
 * failure, a stamp that never settles models a chatroom that cannot be read.
 *
 * There is no file I/O here: the bundle is a string, and the CLI owns the
 * publish. "No partial output" is therefore proven by the throw and by the
 * absence of a result, not by inspecting a directory.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { errorCode, exportPortFor } from './convex-test-ports';
import { runExportBundle } from './export-bundle';
import type { ChatroomExportPort } from './export-driver';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import {
  bundleChecksum,
  ChatroomTransferError,
  type ChatroomExportBundleV1,
} from '../../entities/chatroom-transfer-file';

const AT = new Date('2026-03-01T14:15:02.000Z');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;

interface Fixture {
  sessionId: SessionId;
  userId: Id<'users'>;
  chatroomIds: Id<'chatroom_rooms'>[];
  port: ChatroomExportPort;
}

async function createChatrooms(names: readonly (string | null)[]): Promise<Fixture> {
  sessionCounter += 1;
  const sessionId = `export-bundle-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomIds: Id<'chatroom_rooms'>[] = [];
  for (const name of names) {
    const chatroomId = await t.mutation(api.chatrooms.create, { sessionId });
    if (name !== null) {
      await t.run(async (ctx) => ctx.db.patch(chatroomId, { name }));
    }
    chatroomIds.push(chatroomId);
  }
  return {
    sessionId,
    userId: login.userId as Id<'users'>,
    chatroomIds,
    port: exportPortFor(t, sessionId),
  };
}

async function seedRows(
  chatroomId: Id<'chatroom_rooms'>,
  workingDir: string,
  contents: readonly string[]
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_workspaces', {
      chatroomId,
      machineId: 'machine-1',
      workingDir,
      hostname: 'test-host',
      registeredAt: 1,
      registeredBy: 'user',
      fileTreeSyncEnabled: false,
    });
    for (const content of contents) {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content,
        type: 'message',
      });
    }
  });
}

function bundleArgs(chatroomIds: readonly Id<'chatroom_rooms'>[]) {
  return {
    chatroomIds,
    machineId: 'machine-1',
    cliVersion: '1.2.3',
    now: () => AT,
  };
}

/** Counts `getStamp` calls per chatroom; the retry decision is visible in the count. */
function countingPort(port: ChatroomExportPort): {
  port: ChatroomExportPort;
  stampReads: Map<string, number>;
} {
  const stampReads = new Map<string, number>();
  return {
    port: {
      getStamp: async (chatroomId) => {
        stampReads.set(chatroomId, (stampReads.get(chatroomId) ?? 0) + 1);
        return port.getStamp(chatroomId);
      },
      readPage: (args) => port.readPage(args),
    },
    stampReads,
  };
}

/**
 * Throws `failures` times from the first page read of `chatroomId`, then
 * delegates. Each `runExport` attempt starts with a stamp read, so `attempts`
 * counts started exports per chatroom: a stamp read with no attempt in flight
 * begins a new one, and a throw clears the in-flight flag so the retry counts
 * separately.
 */
function flakyPort(
  port: ChatroomExportPort,
  chatroomId: string,
  failures: number
): {
  port: ChatroomExportPort;
  attempts: (id: string) => number;
  stampReads: Map<string, number>;
} {
  const started = new Map<string, number>();
  const inAttempt = new Set<string>();
  const stamps = new Map<string, number>();
  let remaining = failures;
  return {
    port: {
      getStamp: async (id) => {
        if (!inAttempt.has(id)) {
          started.set(id, (started.get(id) ?? 0) + 1);
          inAttempt.add(id);
        }
        stamps.set(id, (stamps.get(id) ?? 0) + 1);
        return port.getStamp(id);
      },
      readPage: async (args) => {
        if (args.chatroomId === chatroomId && remaining > 0) {
          remaining -= 1;
          inAttempt.delete(chatroomId);
          throw new Error('injected: page read failed');
        }
        return port.readPage(args);
      },
    },
    attempts: (id) => started.get(id) ?? 0,
    stampReads: stamps,
  };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected runExportBundle to fail');
}

// ---------------------------------------------------------------------------
// Bundle content
// ---------------------------------------------------------------------------

describe('bundle content', () => {
  test('wraps the unchanged v1 payloads in list order with paired checksums', async () => {
    const { chatroomIds, port } = await createChatrooms(['Alpha', null]);
    await seedRows(chatroomIds[0], '/repo/a', ['one', 'two']);
    await seedRows(chatroomIds[1], '/repo/b', ['three']);

    const result = await runExportBundle(port, bundleArgs(chatroomIds));
    const bundle = JSON.parse(result.json) as ChatroomExportBundleV1;

    expect(bundle.formatVersion).toBe(1);
    expect(bundle.kind).toBe('chatroom-export-bundle');
    expect(bundle.exportedAt).toBe(AT.toISOString());
    expect(bundle.source).toEqual({ machineId: 'machine-1', cliVersion: '1.2.3' });
    expect(bundle.index.map((entry) => entry.sourceChatroomId)).toEqual(chatroomIds);
    expect(bundle.chatrooms.map((file) => file.source.chatroomId)).toEqual(chatroomIds);

    for (const [i, entry] of bundle.index.entries()) {
      expect(entry.checksum).toBe(bundle.chatrooms[i].checksum);
      expect(bundle.chatrooms[i].exportedAt).toBe(bundle.exportedAt);
    }
    expect(await bundleChecksum(bundle)).toBe(bundle.checksum);

    expect(bundle.index[0]).toMatchObject({
      name: 'Alpha',
      status: 'active',
      messageCount: 2,
      workingDirs: ['/repo/a'],
      omittedAttachments: { count: 0, bytes: 0 },
    });
    expect(bundle.index[1].name).toBeNull();
    expect(bundle.index[1].messageCount).toBe(1);
    expect(typeof bundle.index[0].teamStructureId).toBe('string');
    expect(result.index).toEqual(bundle.index);
  });

  test('sums the omitted attachments across the index', async () => {
    const { chatroomIds, userId, port } = await createChatrooms(['Alpha', 'Beta']);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_fileAttachments', {
        chatroomId: chatroomIds[0],
        ownerUserId: userId,
        uploadedByRole: 'builder',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        status: 'attached',
        createdAt: Date.now(),
      });
    });

    const result = await runExportBundle(port, bundleArgs(chatroomIds));

    expect(result.index[0].omittedAttachments).toEqual({ count: 1, bytes: 5 });
    expect(result.index[1].omittedAttachments).toEqual({ count: 0, bytes: 0 });
    expect(result.omittedAttachments).toEqual({ count: 1, bytes: 5 });
  });

  test('the checksum ignores exportedAt and source but changes with the index', async () => {
    const { chatroomIds, port } = await createChatrooms(['Alpha']);
    await seedRows(chatroomIds[0], '/repo/a', ['one']);

    const first = JSON.parse(
      (await runExportBundle(port, bundleArgs(chatroomIds))).json
    ) as ChatroomExportBundleV1;
    const second = JSON.parse(
      (
        await runExportBundle(port, {
          ...bundleArgs(chatroomIds),
          machineId: 'other-machine',
          now: () => new Date('2027-01-01T00:00:00.000Z'),
        })
      ).json
    ) as ChatroomExportBundleV1;

    expect(second.exportedAt).not.toBe(first.exportedAt);
    expect(second.source.machineId).not.toBe(first.source.machineId);
    expect(second.checksum).toBe(first.checksum);

    const entry = first.index[0];
    const base = await bundleChecksum({
      formatVersion: 1,
      kind: 'chatroom-export-bundle',
      index: [entry],
    });
    const tampered = await bundleChecksum({
      formatVersion: 1,
      kind: 'chatroom-export-bundle',
      index: [{ ...entry, checksum: 'f'.repeat(64) }],
    });
    expect(tampered).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
// Retry and all-or-nothing
// ---------------------------------------------------------------------------

describe('retry', () => {
  test('retries a failed chatroom once and includes it when the retry succeeds', async () => {
    const { chatroomIds, port } = await createChatrooms(['Alpha', 'Beta']);
    await seedRows(chatroomIds[0], '/repo/a', ['one']);
    await seedRows(chatroomIds[1], '/repo/b', ['two']);
    const flaky = flakyPort(port, chatroomIds[1], 1);

    const result = await runExportBundle(flaky.port, bundleArgs(chatroomIds));

    expect(result.index.map((entry) => entry.sourceChatroomId)).toEqual(chatroomIds);
    expect(flaky.attempts(chatroomIds[1])).toBe(2);
    expect(flaky.attempts(chatroomIds[0])).toBe(1);
  });

  test('fails the whole run with one detail line per chatroom that failed twice', async () => {
    const { chatroomIds, port } = await createChatrooms(['Alpha', 'Beta', 'Gamma']);
    const flaky = flakyPort(port, chatroomIds[1], Number.POSITIVE_INFINITY);

    const error = await capture(runExportBundle(flaky.port, bundleArgs(chatroomIds)));

    expect(error).toBeInstanceOf(ChatroomTransferError);
    expect((error as ChatroomTransferError).code).toBe('EXPORT_ALL_INCOMPLETE');
    expect((error as ChatroomTransferError).details).toEqual([
      `${chatroomIds[1]}: [UNKNOWN] injected: page read failed`,
    ]);
    // Two attempts is the one configured retry; the other chatrooms are read once.
    expect(flaky.attempts(chatroomIds[1])).toBe(2);
    expect(flaky.attempts(chatroomIds[0])).toBe(1);
    expect(flaky.attempts(chatroomIds[2])).toBe(1);
  });
});

describe('size', () => {
  test('EXPORT_TOO_LARGE is not retried', async () => {
    const { chatroomIds, port } = await createChatrooms(['Alpha']);
    await seedRows(chatroomIds[0], '/repo/a', ['a'.repeat(1_000), 'b'.repeat(1_000)]);
    const counting = countingPort(port);

    const error = await capture(
      runExportBundle(counting.port, {
        ...bundleArgs(chatroomIds),
        limits: { maxFileBytes: 1_500 },
      })
    );

    expect(errorCode(error)).toBe('EXPORT_TOO_LARGE');
    expect(counting.stampReads.get(chatroomIds[0])).toBe(1);
  });
});
