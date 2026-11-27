'use client';

import { exportFileName } from '@workspace/backend/src/domain/entities/chatroom-transfer-file-name';
import { runExport } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import { useConvex } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { createExportPort, WEB_EXPORT_SOURCE_VERSION } from '../lib/convexTransferPorts';
import type { OmittedAttachments } from '../lib/transferCopy';
import { transferFailureOf, type TransferFailure } from '../lib/transferFailure';

import { downloadBlobFile } from '@/modules/chatroom/lib/messageExport/downloadTextFile';

export type ChatroomExportOutcome =
  | { ok: true; fileName: string; omitted: OmittedAttachments }
  | { ok: false; failure: TransferFailure };

export function useChatroomExport(): {
  state: 'idle' | 'running';
  run(chatroomId: string): Promise<ChatroomExportOutcome>;
} {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const [state, setState] = useState<'idle' | 'running'>('idle');

  const run = useCallback(
    // fallow-ignore-next-line complexity
    async (chatroomId: string): Promise<ChatroomExportOutcome> => {
      setState('running');
      try {
        if (!sessionId) return { ok: false, failure: transferFailureOf(undefined) };
        const at = new Date();
        const { file, json } = await runExport(createExportPort(convex, sessionId), {
          chatroomId,
          cliVersion: WEB_EXPORT_SOURCE_VERSION,
          now: () => at,
        });
        const fileName = exportFileName(chatroomId, at);
        downloadBlobFile(fileName, new Blob([json], { type: 'application/json' }));
        const attachments = file.omitted.chatroom_fileAttachments;
        return {
          ok: true,
          fileName,
          omitted: { count: attachments?.count ?? 0, bytes: attachments?.bytes ?? 0 },
        };
      } catch (error) {
        return { ok: false, failure: transferFailureOf(error) };
      } finally {
        setState('idle');
      }
    },
    [convex, sessionId]
  );

  return { state, run };
}
