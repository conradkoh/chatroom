import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ChatroomExportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type { ConvexReactClient } from 'convex/react';
import type { SessionId } from 'convex-helpers/server/sessions';

/** Written into `source.cliVersion` of every file the browser exports. Informational only. */
export const WEB_EXPORT_SOURCE_VERSION = 'webapp';

type ConvexQueryClient = Pick<ConvexReactClient, 'query'>;

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

/** The caller's chatrooms with an active workspace on `machineId`, most recent activity first. */
export function listExportableChatrooms(
  convex: ConvexQueryClient,
  sessionId: SessionId,
  machineId: string
): Promise<ExportableChatroom[]> {
  return convex.query(api.chatroomExport.listForMachine, { sessionId, machineId });
}
