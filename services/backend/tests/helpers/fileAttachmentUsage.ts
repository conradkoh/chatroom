/**
 * Shared test setup for file attachment specs.
 *
 * These helpers create real rows through `t.run` (the S2 setup precedent) and
 * assert invariant I3 by recomputing usage from the attachment rows. They never
 * mock an internal collaborator.
 */

import { expect } from 'vitest';

import { createDuoTeamChatroom, createTestSession } from './integration';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
import { t } from '../../test.setup';

let sequence = 0;

/** A web session, its user, and a duo-team chatroom owned by that user. */
export interface FileTestUser {
  sessionId: string;
  userId: Id<'users'>;
  chatroomId: Id<'chatroom_rooms'>;
}

/** Creates a web session with an owned duo-team chatroom. */
export async function setupFileUser(label: string): Promise<FileTestUser> {
  const rawSessionId = `file-attachments-${label}-${++sequence}`;
  const { sessionId } = await createTestSession(rawSessionId);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const userId = await t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (!session?.userId) throw new Error('missing session user');
    return session.userId;
  });
  return { sessionId: sessionId as unknown as string, userId, chatroomId };
}

/** Creates a CLI session for the same user (user-scoped, not chatroom-scoped). */
export async function createCliSession(user: FileTestUser): Promise<string> {
  const sessionId = `file-attachments-cli-${++sequence}`;
  await t.run(async (ctx) => {
    await ctx.db.insert('cliSessions', {
      sessionId,
      userId: user.userId,
      isActive: true,
      createdAt: Date.now(),
    });
  });
  return sessionId;
}

/** Reads the stored usage row for one scope. */
export async function getFileUsageRow(
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'> | undefined
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_fileStorageUsage')
      .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId).eq('chatroomId', chatroomId))
      .unique()
  );
}

/**
 * Seeds `count` attached rows and mirrors them into the usage counters so the
 * fixture is consistent with I3 before the code under test runs.
 */
export async function seedAttachedRows(args: {
  userId: Id<'users'>;
  chatroomId: Id<'chatroom_rooms'>;
  count: number;
  sizeBytes: number;
  startAttachedAt?: number;
  filenamePrefix?: string;
}): Promise<Id<'chatroom_fileAttachments'>[]> {
  return await t.run(async (ctx) => {
    const attachedAt = args.startAttachedAt ?? Date.now();
    const ids: Id<'chatroom_fileAttachments'>[] = [];
    for (let i = 0; i < args.count; i++) {
      ids.push(
        await ctx.db.insert('chatroom_fileAttachments', {
          chatroomId: args.chatroomId,
          ownerUserId: args.userId,
          uploadedByRole: 'planner',
          filename: `${args.filenamePrefix ?? 'seed'}-${i}.txt`,
          mimeType: 'text/plain',
          sizeBytes: args.sizeBytes,
          status: 'attached' as const,
          createdAt: attachedAt,
          attachedAt: attachedAt + i,
        })
      );
    }
    await addUsageBytes(ctx, args.userId, args.chatroomId, args.sizeBytes * args.count, args.count);
    return ids;
  });
}

/** Adds bytes/files to the stored counters for one chatroom and the user total. */
async function addUsageBytes(
  ctx: MutationCtx,
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'>,
  bytes: number,
  files: number
): Promise<void> {
  for (const scope of [chatroomId, undefined]) {
    const existing = await ctx.db
      .query('chatroom_fileStorageUsage')
      .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId).eq('chatroomId', scope))
      .unique();

    if (existing) {
      await ctx.db.patch('chatroom_fileStorageUsage', existing._id, {
        bytes: existing.bytes + bytes,
        fileCount: existing.fileCount + files,
        updatedAt: Date.now(),
      });
      continue;
    }

    await ctx.db.insert('chatroom_fileStorageUsage', {
      userId,
      ...(scope === undefined ? {} : { chatroomId: scope }),
      bytes,
      fileCount: files,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Invariant I3: for each scope, the usage counter equals the Σ sizeBytes and
 * count of that scope's `uploaded` + `attached` rows.
 */
export async function assertUsageInvariant(userId: Id<'users'>): Promise<void> {
  const state = await t.run(async (ctx) => {
    const counted = [
      ...(await ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) =>
          q.eq('ownerUserId', userId).eq('status', 'uploaded')
        )
        .collect()),
      ...(await ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) =>
          q.eq('ownerUserId', userId).eq('status', 'attached')
        )
        .collect()),
    ];

    const expectedByChatroom = new Map<string, { bytes: number; files: number }>();
    let totalBytes = 0;
    let totalFiles = 0;
    for (const row of counted) {
      totalBytes += row.sizeBytes;
      totalFiles += 1;
      const existing = expectedByChatroom.get(row.chatroomId) ?? { bytes: 0, files: 0 };
      existing.bytes += row.sizeBytes;
      existing.files += 1;
      expectedByChatroom.set(row.chatroomId, existing);
    }

    const usageRows = await ctx.db
      .query('chatroom_fileStorageUsage')
      .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId))
      .collect();

    return {
      expectedByChatroom: [...expectedByChatroom].map(([chatroomId, expected]) => ({
        chatroomId,
        ...expected,
      })),
      totalBytes,
      totalFiles,
      usageRows,
    };
  });

  const totalRow = state.usageRows.find((row) => row.chatroomId === undefined);
  expect(totalRow?.bytes ?? 0).toBe(state.totalBytes);
  expect(totalRow?.fileCount ?? 0).toBe(state.totalFiles);

  for (const usage of state.usageRows) {
    if (usage.chatroomId === undefined) continue;
    const expected = state.expectedByChatroom.find(
      (entry) => entry.chatroomId === usage.chatroomId
    ) ?? { bytes: 0, files: 0 };
    expect(usage.bytes).toBe(expected.bytes);
    expect(usage.fileCount).toBe(expected.files);
  }
}
