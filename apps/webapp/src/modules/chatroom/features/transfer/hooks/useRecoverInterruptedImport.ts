/**
 * Chatroom import — recovery of a record left behind by a closed tab.
 *
 * The notice only offers a record whose heartbeat is stale: a live import in
 * another tab keeps its heartbeat fresh, so its chatroom is never removed from
 * under it. Removing drains `chatroomImport.rollback` one budgeted batch at a
 * time; a batch that deletes nothing can never make progress and is reported as
 * a failure, which keeps the record so the user can retry or keep the room.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import type { SessionId } from 'convex-helpers/server/sessions';
import { useCallback, useEffect, useState } from 'react';

import {
  clearInflightImport,
  isStaleInflightImport,
  readInflightImport,
  type InflightImportRecord,
} from '../lib/inflightImport';
import { transferFailureOf } from '../lib/transferFailure';

export type RecoverState = 'idle' | 'rollingBack' | 'removed' | { failed: string };

interface UseRecoverInterruptedImportResult {
  /** The leftover record, only once its tab is gone. */
  pending: InflightImportRecord | null;
  state: RecoverState;
  remove(): Promise<void>;
  dismiss(): void;
}

const POLL_MS = 5_000;

export function useRecoverInterruptedImport(): UseRecoverInterruptedImportResult {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const [record, setRecord] = useState<InflightImportRecord | null>(() => readInflightImport());
  const [state, setState] = useState<RecoverState>('idle');

  // Poll only while a record exists: with none there is nothing to refresh, and
  // staleness is re-evaluated on every poll that reads the record back.
  const hasRecord = record !== null;
  useEffect(() => {
    if (!hasRecord) return;
    const id = setInterval(() => setRecord(readInflightImport()), POLL_MS);
    return () => clearInterval(id);
  }, [hasRecord]);

  const remove = useCallback(async (): Promise<void> => {
    const current = record;
    if (current === null) return;
    if (sessionId === undefined) {
      setState({ failed: transferFailureOf(undefined).message });
      return;
    }
    setState('rollingBack');
    try {
      await drainRollback(convex, sessionId, current.chatroomId);
      clearInflightImport();
      setRecord(null);
      setState('removed');
    } catch (error) {
      setState({ failed: transferFailureOf(error).message });
    }
  }, [convex, record, sessionId]);

  const dismiss = useCallback(() => {
    clearInflightImport();
    setRecord(null);
    setState('idle');
  }, []);

  const pending = record !== null && isStaleInflightImport(record, Date.now()) ? record : null;
  return { pending, state, remove, dismiss };
}

/** One rollback call per budgeted batch; `drained` is the only success. */
async function drainRollback(
  convex: ReturnType<typeof useConvex>,
  sessionId: SessionId,
  chatroomId: string
): Promise<void> {
  for (;;) {
    const { drained, deleted } = await convex.mutation(api.chatroomImport.rollback, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });
    if (drained) return;
    if (deleted === 0) throw new Error('Rollback made no progress.');
  }
}
