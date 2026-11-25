/**
 * Chatroom export — convex-test adapters (test support only).
 *
 * Bridges the export port to the real Convex queries through `convex-test`, so
 * the driver spec exercises the real paging, auth and serialization path. Only
 * spec files import this module; it is never part of the shipped backend or CLI
 * bundles.
 *
 * `wrapPortMutatingBetweenPages` substitutes a port (the seam the driver owns),
 * never an internal collaborator: the hook runs before each `readPage`, which is
 * how a spec simulates a write landing between two reads.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import type { convexTest } from 'convex-test';

import type { ChatroomExportPort } from './export-driver';
import type { ExportPage, ExportStamp } from './export-read';
import type { ChatroomImportPort } from './import-driver';
import { api } from '../../../../convex/_generated/api';
import type { Id, TableNames } from '../../../../convex/_generated/dataModel';
import schema from '../../../../convex/schema';
import { t } from '../../../../test.setup';
import type { ExportCategory } from '../../entities/chatroom-transfer-file';

export type TestConvex = ReturnType<typeof convexTest>;

/** The port backed by the real `chatroomExport` queries. */
export function exportPortFor(t: TestConvex, sessionId: SessionId): ChatroomExportPort {
  const asRoomId = (chatroomId: string) => chatroomId as Id<'chatroom_rooms'>;

  return {
    getStamp: async (chatroomId) =>
      (await t.query(api.chatroomExport.getStamp, {
        sessionId,
        chatroomId: asRoomId(chatroomId),
      })) as ExportStamp,
    readPage: async (args) =>
      (await t.query(api.chatroomExport.readPage, {
        sessionId,
        chatroomId: asRoomId(args.chatroomId),
        category: args.category,
        cursor: args.cursor,
      })) as ExportPage,
  };
}

/** Delegates to `port`, running `hook` before every page read. */
export function wrapPortMutatingBetweenPages(
  port: ChatroomExportPort,
  hook: (category: ExportCategory, cursor: string | null) => Promise<void>
): ChatroomExportPort {
  return {
    getStamp: (chatroomId) => port.getStamp(chatroomId),
    readPage: async (args) => {
      await hook(args.category, args.cursor);
      return port.readPage(args);
    },
  };
}

/** The import port backed by the real `chatroomImport` query and mutations. */
export function importPortFor(t: TestConvex, sessionId: SessionId): ChatroomImportPort {
  const asRoomId = (chatroomId: string) => chatroomId as Id<'chatroom_rooms'>;

  return {
    preflight: async (args) => {
      const target = await t.query(api.chatroomImport.preflight, {
        sessionId,
        machineId: args.machineId,
        teamStructureId: args.teamStructureId,
        workingDirs: args.workingDirs,
      });
      return { machineId: args.machineId, ...target };
    },
    begin: async (args) => {
      const result = await t.mutation(api.chatroomImport.begin, {
        sessionId,
        header: args.header,
        machineId: args.machineId,
      });
      return { chatroomId: result.chatroomId };
    },
    applyChunk: async (args) =>
      await t.mutation(api.chatroomImport.applyChunk, {
        sessionId,
        chatroomId: asRoomId(args.chatroomId),
        chunk: args.chunk,
      }),
    finalize: async (args) => {
      await t.mutation(api.chatroomImport.finalize, {
        sessionId,
        chatroomId: asRoomId(args.chatroomId),
        status: args.status,
        lastActivityAt: args.lastActivityAt,
        nextQueuePosition: args.nextQueuePosition,
      });
    },
    rollback: async (args) =>
      await t.mutation(api.chatroomImport.rollback, {
        sessionId,
        chatroomId: asRoomId(args.chatroomId),
      }),
  };
}

/** Fails the nth applyChunk call (1-based). `before` throws without calling the port; `after` lets the chunk land, then throws. */
export function failOnNthApplyChunk(
  port: ChatroomImportPort,
  n: number,
  when: 'before' | 'after'
): ChatroomImportPort {
  let calls = 0;
  return {
    ...port,
    applyChunk: async (args) => {
      calls += 1;
      if (calls === n && when === 'before') throw injected(`applyChunk ${n} failed before`);
      const result = await port.applyChunk(args);
      if (calls === n && when === 'after') throw injected(`applyChunk ${n} failed after`);
      return result;
    },
  };
}

/** Throws from finalize without calling the port. The room stays completed. */
export function failFinalize(port: ChatroomImportPort): ChatroomImportPort {
  return {
    ...port,
    finalize: async () => {
      throw injected('finalize failed');
    },
  };
}

/** Throws from every rollback call without calling the port. */
export function failRollback(port: ChatroomImportPort): ChatroomImportPort {
  return {
    ...port,
    rollback: async () => {
      throw injected('rollback failed');
    },
  };
}

function injected(message: string): Error {
  return new Error(`injected: ${message}`);
}

/** Rows carrying `chatroomId` in every schema table, plus the room itself; non-zero entries only. */
export async function chatroomRowCounts(
  chatroomId: Id<'chatroom_rooms'>
): Promise<Record<string, number>> {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of Object.keys(schema.tables) as TableNames[]) {
      const rows = await ctx.db.query(table).collect();
      const count = rows.filter(
        (row) => (row as { chatroomId?: unknown }).chatroomId === chatroomId
      ).length;
      if (count > 0) counts[table] = count;
    }
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    if (room) counts.chatroom_rooms = (counts.chatroom_rooms ?? 0) + 1;
    return counts;
  });
}

/** Reads the transfer code from a thrown `ConvexError` or `ChatroomTransferError`. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = readCode((error as { code?: unknown }).code);
  if (direct !== undefined) return direct;
  return readCode((error as { data?: unknown }).data);
}

/** A code is either the error's own `code` or `data.code` on a `ConvexError`. */
function readCode(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  return asCode(value.code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function asCode(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
