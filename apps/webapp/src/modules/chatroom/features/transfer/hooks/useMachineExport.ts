'use client';

import { bundleFileName } from '@workspace/backend/src/domain/entities/chatroom-transfer-file-name';
import { runExportBundle } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import { useConvex } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import {
  createExportPort,
  listExportableChatrooms,
  WEB_EXPORT_SOURCE_VERSION,
} from '../lib/convexTransferPorts';
import type { OmittedAttachments } from '../lib/transferCopy';
import { transferFailureOf, type TransferFailure } from '../lib/transferFailure';

import { downloadBlobFile } from '@/modules/chatroom/lib/messageExport/downloadTextFile';

export type MachineExportState =
  { kind: 'idle' } | { kind: 'listing' } | { kind: 'exporting'; done: number; total: number };

export interface FailedChatroom {
  chatroomId: string;
  name: string | null;
}

export type MachineExportOutcome =
  | { ok: true; empty: true }
  | {
      ok: true;
      empty?: false;
      fileName: string;
      chatroomCount: number;
      omitted: OmittedAttachments;
    }
  | { ok: false; cancelled: true }
  | {
      ok: false;
      cancelled?: false;
      failure: TransferFailure;
      failed: FailedChatroom[];
      total: number;
    };

export function useMachineExport(machineId: string): {
  state: MachineExportState;
  run(): Promise<MachineExportOutcome>;
  cancel(): void;
} {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const [state, setState] = useState<MachineExportState>({ kind: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(
    // fallow-ignore-next-line complexity
    async (): Promise<MachineExportOutcome> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      let rows: ExportableChatroom[] = [];
      setState({ kind: 'listing' });
      try {
        if (!sessionId) {
          return { ok: false, failure: transferFailureOf(undefined), failed: [], total: 0 };
        }
        rows = await listExportableChatrooms(convex, sessionId, machineId);
        if (rows.length === 0) return { ok: true, empty: true };

        const at = new Date();
        setState({ kind: 'exporting', done: 0, total: rows.length });
        const result = await runExportBundle(createExportPort(convex, sessionId), {
          chatroomIds: rows.map((row) => row.chatroomId),
          machineId,
          cliVersion: WEB_EXPORT_SOURCE_VERSION,
          now: () => at,
          signal: controller.signal,
          onProgress: ({ done, total }) => setState({ kind: 'exporting', done, total }),
        });
        const fileName = bundleFileName(machineId, at);
        downloadBlobFile(fileName, new Blob([result.json], { type: 'application/json' }));
        return {
          ok: true,
          fileName,
          chatroomCount: result.index.length,
          omitted: result.omittedAttachments,
        };
      } catch (error) {
        if (controller.signal.aborted) return { ok: false, cancelled: true };
        const failure = transferFailureOf(error);
        return {
          ok: false,
          failure,
          failed: failedChatrooms(failure, rows),
          total: rows.length,
        };
      } finally {
        controllerRef.current = null;
        setState({ kind: 'idle' });
      }
    },
    [convex, sessionId, machineId]
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  return { state, run, cancel };
}

/**
 * EXPORT_ALL_INCOMPLETE carries one detail per failed chatroom: `<chatroomId>: [CODE] message`.
 * Only the id is parsed; the name comes from the listing rows the hook already holds.
 */
function failedChatrooms(
  failure: TransferFailure,
  rows: readonly ExportableChatroom[]
): FailedChatroom[] {
  if (failure.code !== 'EXPORT_ALL_INCOMPLETE') return [];
  return failure.details.map((detail) => {
    const chatroomId = detail.slice(0, detail.indexOf(': ['));
    const row = rows.find((candidate) => candidate.chatroomId === chatroomId);
    return { chatroomId, name: row?.name ?? null };
  });
}
