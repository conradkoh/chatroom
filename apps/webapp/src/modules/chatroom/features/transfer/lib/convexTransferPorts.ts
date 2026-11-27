import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ChatroomExportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type { ChatroomImportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-driver';
import type { ConvexReactClient } from 'convex/react';
import type { SessionId } from 'convex-helpers/server/sessions';

/** Written into `source.cliVersion` of every file the browser exports. Informational only. */
export const WEB_EXPORT_SOURCE_VERSION = 'webapp';

type ConvexQueryClient = Pick<ConvexReactClient, 'query'>;

/** The mutation half of the Convex client; the import writes one chunk per call. */
type ConvexMutationClient = Pick<ConvexReactClient, 'mutation'>;

export function createExportPort(
  convex: ConvexQueryClient,
  sessionId: SessionId
): ChatroomExportPort {
  return {
    getStamp: (chatroomId) =>
      convex.query(api.chatroomExport.getStamp, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      }),
    readPage: ({ chatroomId, category, cursor }) =>
      convex.query(api.chatroomExport.readPage, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        category,
        cursor,
      }),
  };
}

/**
 * The import port the browser passes to `runSelectedImports`. Each method is
 * exactly one Convex call, mirroring the CLI's `convexImportPort`. The file
 * itself never leaves the browser: only `header`/`chunk` values are sent.
 */
export function createImportPort(
  convex: ConvexQueryClient & ConvexMutationClient,
  sessionId: SessionId
): ChatroomImportPort {
  return {
    // The query reports what the machine offers; the machineId comes from the
    // call, exactly as the CLI's convex-test port composes it.
    preflight: async (a) => ({
      machineId: a.machineId,
      ...(await convex.query(api.chatroomImport.preflight, { sessionId, ...a })),
    }),
    begin: (a) =>
      convex.mutation(api.chatroomImport.begin, {
        sessionId,
        header: a.header,
        machineId: a.machineId,
      }),
    applyChunk: (a) =>
      convex.mutation(api.chatroomImport.applyChunk, {
        sessionId,
        chatroomId: a.chatroomId as Id<'chatroom_rooms'>,
        chunk: a.chunk,
      }),
    finalize: async (a) => {
      await convex.mutation(api.chatroomImport.finalize, {
        sessionId,
        chatroomId: a.chatroomId as Id<'chatroom_rooms'>,
        status: a.status,
        lastActivityAt: a.lastActivityAt,
        nextQueuePosition: a.nextQueuePosition,
      });
    },
    rollback: (a) =>
      convex.mutation(api.chatroomImport.rollback, {
        sessionId,
        chatroomId: a.chatroomId as Id<'chatroom_rooms'>,
      }),
  };
}

/** The caller's chatrooms with an active workspace on `machineId`, most recent activity first. */
export function listExportableChatrooms(
  convex: ConvexQueryClient,
  sessionId: SessionId,
  machineId: string
): Promise<ExportableChatroom[]> {
  return convex.query(api.chatroomExport.listForMachine, { sessionId, machineId });
}
