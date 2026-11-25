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
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
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
