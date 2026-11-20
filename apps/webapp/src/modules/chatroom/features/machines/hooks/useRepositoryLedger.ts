'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  useSessionMutation,
  useSessionPaginatedQuery,
  useSessionQuery,
} from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getConvexErrorCode, getMachineErrorCopy } from '../lib/machineErrorCopy';

type RequestId = Id<'chatroom_repositoryLedgerRequests'>;
type LedgerRequestRow = Doc<'chatroom_repositoryLedgerRequests'>;
type CompletedRow = LedgerRequestRow & { status: 'completed' };

const LEDGER_PAGE_SIZE = 300;
const MACHINE_OFFLINE_CODE = 'MACHINE_OFFLINE';
const REQUEST_FALLBACK_COPY = 'Could not ask the daemon. Try again.';
const DAEMON_FAILURE_FALLBACK_COPY = 'The daemon reported an error.';
const RESCAN_EXPIRED_COPY = 'The rescan expired. Try again.';

export interface LedgerEntryView {
  path: string;
  name: string;
  root: string;
  branch?: string;
  remoteUrl?: string;
  discoveredAt: number;
  hasChatroom: boolean;
  chatroomId?: Id<'chatroom_rooms'>;
}

export interface LedgerRootSummary {
  path: string;
  status: 'ok' | 'missing' | 'unreadable';
  repositoryCount: number;
}

/** The displayed snapshot. Stays visible while a rescan is in flight. */
export interface LedgerSnapshotMeta {
  requestId: RequestId;
  generatedAt: number;
  truncated: boolean;
  invalidPathCount: number;
  roots: LedgerRootSummary[];
  totalCount: number;
}

export type RescanIssue = { kind: 'timedOut' } | { kind: 'failed'; message: string };

export type LedgerView =
  | { kind: 'idle'; reason?: 'expired'; canRequest: boolean; blockedBy?: 'offline' | 'no-roots' }
  | { kind: 'asking'; rescan: boolean; hasPreviousSnapshot: boolean }
  | { kind: 'ready'; rescanIssue?: RescanIssue }
  | { kind: 'timedOut' }
  | { kind: 'failed'; message: string };

export interface LedgerGate {
  /** undefined while connectivity is unresolved. */
  connected: boolean | undefined;
  /** undefined while the roots list is loading. */
  hasRoots: boolean | undefined;
}

export interface UseRepositoryLedgerResult {
  view: LedgerView;
  /** The displayed snapshot, or null. Kept during a rescan. */
  snapshot: LedgerSnapshotMeta | null;
  /** Rows of the displayed snapshot, auto-loaded through every page. */
  entries: LedgerEntryView[];
  /** True while the displayed snapshot's pages are still loading. */
  isLoadingPages: boolean;
  request: (rescan: boolean) => Promise<void>;
  cancel: () => void;
}

/** The request this hook issued. `requestId` is null while the request call is in flight. */
interface AskState {
  requestId: RequestId | null;
  rescan: boolean;
}

/** Where the issued request stands. `null` means no request was issued. */
type AskPhase = 'starting' | 'asking' | 'timedOut' | 'failed' | 'completed' | 'missing';

// fallow-ignore-next-line complexity
function toSnapshotMeta(row: CompletedRow): LedgerSnapshotMeta {
  return {
    requestId: row._id,
    generatedAt: row.ledgerGeneratedAt ?? row.completedAt ?? row.updatedAt,
    truncated: row.truncated === true,
    invalidPathCount: row.invalidPathCount ?? 0,
    roots: row.roots ?? [],
    totalCount: row.repositoryCount ?? 0,
  };
}

// fallow-ignore-next-line complexity
function derivePhase(
  ask: AskState | null,
  askRow: LedgerRequestRow | null | undefined,
  now: number
): AskPhase | null {
  if (ask === null) return null;
  if (ask.requestId === null) return 'starting';
  if (askRow === undefined) return 'asking';
  if (askRow === null) return 'missing';
  if (askRow.status === 'completed') return 'completed';
  if (askRow.status === 'failed') return 'failed';
  return askRow.expiresAt <= now ? 'timedOut' : 'asking';
}

/** Build the ask-independent idle gate. Offline wins over missing roots. Omit `blockedBy` when unblocked. */
// fallow-ignore-next-line complexity
function idleGate(gate: LedgerGate, offlineRejected: boolean) {
  const blockedBy: 'offline' | 'no-roots' | undefined =
    gate.connected === false || offlineRejected
      ? 'offline'
      : gate.hasRoots === false
        ? 'no-roots'
        : undefined;
  const canRequest = blockedBy === undefined && gate.connected === true && gate.hasRoots === true;
  return blockedBy === undefined ? { canRequest } : { canRequest, blockedBy };
}

interface DeriveViewInput {
  phase: AskPhase | null;
  rescan: boolean;
  askRow: LedgerRequestRow | null | undefined;
  snapshot: LedgerSnapshotMeta | null;
  snapshotExpired: boolean;
  callError: string | null;
  gate: LedgerGate;
  offlineRejected: boolean;
}

/** The ask's failure, shown as a rescan issue when a snapshot is still displayed. */
// fallow-ignore-next-line complexity
function askFailure(input: DeriveViewInput): RescanIssue | null {
  const { phase, askRow, callError } = input;
  if (phase === 'timedOut') return { kind: 'timedOut' };
  if (phase === 'failed') {
    return { kind: 'failed', message: askRow?.errorMessage ?? DAEMON_FAILURE_FALLBACK_COPY };
  }
  if (phase === 'missing') return { kind: 'failed', message: RESCAN_EXPIRED_COPY };
  if (callError !== null) return { kind: 'failed', message: callError };
  return null;
}

/**
 * Derive the view in order: asking, ask failure, displayed snapshot, then the idle gate.
 * A failing ask keeps the previous snapshot visible as a `ready` view with a `rescanIssue`.
 */
// fallow-ignore-next-line complexity
function deriveView(input: DeriveViewInput): LedgerView {
  const { phase, rescan, snapshot, snapshotExpired, gate, offlineRejected } = input;

  if (phase === 'starting' || phase === 'asking') {
    return { kind: 'asking', rescan, hasPreviousSnapshot: snapshot !== null };
  }

  const failure = askFailure(input);
  if (failure !== null) {
    if (snapshot !== null) return { kind: 'ready', rescanIssue: failure };
    if (failure.kind === 'timedOut') return { kind: 'timedOut' };
    // A missing ask with no snapshot falls through to idle with reason expired.
    if (phase !== 'missing') return { kind: 'failed', message: failure.message };
  }

  if (snapshot !== null) return { kind: 'ready' };

  return {
    kind: 'idle',
    ...(snapshotExpired || phase === 'missing' ? { reason: 'expired' as const } : {}),
    ...idleGate(gate, offlineRejected),
  };
}

// fallow-ignore-next-line complexity
export function useRepositoryLedger(
  machineId: string,
  gate: LedgerGate
): UseRepositoryLedgerResult {
  const [ask, setAsk] = useState<AskState | null>(null);
  const [shownId, setShownId] = useState<RequestId | null>(null);
  const [offlineRejected, setOfflineRejected] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const sequence = useRef(0);
  const latest = useRef<{ askId: RequestId | null; shownId: RequestId | null }>({
    askId: null,
    shownId: null,
  });

  const requestMutation = useSessionMutation(api.repositoryLedger.request);
  const discardMutation = useSessionMutation(api.repositoryLedger.discard);
  // Kept in a ref so the unmount cleanup below runs only on unmount.
  const discardRef = useRef<typeof discardMutation | null>(null);
  useEffect(() => {
    discardRef.current = discardMutation;
  });

  const discardQuietly = useCallback((requestId: RequestId) => {
    const discard = discardRef.current;
    if (discard) void discard({ requestId }).catch(() => undefined);
  }, []);

  const askId = ask?.requestId ?? null;
  const askRow = useSessionQuery(api.repositoryLedger.get, askId ? { requestId: askId } : 'skip');
  const shownRow = useSessionQuery(
    api.repositoryLedger.get,
    shownId ? { requestId: shownId } : 'skip'
  );

  const phase = derivePhase(ask, askRow, now);
  const snapshotRow = phase === 'completed' ? askRow : shownRow;
  const snapshot =
    snapshotRow && snapshotRow.status === 'completed' && snapshotRow.expiresAt > now
      ? toSnapshotMeta(snapshotRow as CompletedRow)
      : null;
  const snapshotExpired =
    shownId !== null &&
    (shownRow === null ||
      (shownRow !== undefined && shownRow.status === 'completed' && shownRow.expiresAt <= now));

  // Re-render at each deadline so pending→timed out and completed→expired flip without polling.
  const askExpiresAt = askRow?.expiresAt;
  const shownExpiresAt = shownRow?.expiresAt;
  useEffect(() => {
    const upcoming = [askExpiresAt, shownExpiresAt].filter(
      (t): t is number => t !== undefined && t > now
    );
    if (upcoming.length === 0) return;
    const target = Math.min(...upcoming);
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), target)),
      Math.max(0, target - Date.now())
    );
    return () => clearTimeout(timer);
  }, [askExpiresAt, shownExpiresAt, now]);

  // Promote a completed ask to the displayed snapshot; discard the one it replaces.
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (phase !== 'completed' || !ask || ask.requestId === null) return;
    const completedId = ask.requestId;
    const previous = shownId;
    setShownId(completedId);
    setAsk(null);
    if (previous !== null && previous !== completedId) discardQuietly(previous);
  }, [phase, ask, shownId, discardQuietly]);

  useEffect(() => {
    latest.current = { askId, shownId };
  }, [askId, shownId]);

  // Unmount (collapse or leave the page) discards the snapshot and any pending ask.
  useEffect(
    () => () => {
      sequence.current += 1;
      const { askId: pendingId, shownId: snapshotId } = latest.current;
      if (pendingId) discardQuietly(pendingId);
      if (snapshotId) discardQuietly(snapshotId);
    },
    [discardQuietly]
  );

  const request = useCallback(
    // fallow-ignore-next-line complexity
    async (rescan: boolean) => {
      const current = ++sequence.current;
      setOfflineRejected(false);
      setCallError(null);
      setAsk({ requestId: null, rescan });
      try {
        const { requestId } = await requestMutation({ machineId, rescan });
        if (current !== sequence.current) {
          discardQuietly(requestId);
          return;
        }
        setAsk({ requestId, rescan });
      } catch (error) {
        if (current !== sequence.current) return;
        setAsk(null);
        if (getConvexErrorCode(error) === MACHINE_OFFLINE_CODE) setOfflineRejected(true);
        else setCallError(getMachineErrorCopy(error, REQUEST_FALLBACK_COPY));
      }
    },
    [machineId, requestMutation, discardQuietly]
  );

  const cancel = useCallback(() => {
    sequence.current += 1;
    const { askId: pendingId, shownId: snapshotId } = latest.current;
    setAsk(null);
    setShownId(null);
    setOfflineRejected(false);
    setCallError(null);
    if (pendingId) discardQuietly(pendingId);
    if (snapshotId) discardQuietly(snapshotId);
  }, [discardQuietly]);

  const view = deriveView({
    phase,
    rescan: ask?.rescan ?? false,
    askRow,
    snapshot,
    snapshotExpired,
    callError,
    gate,
    offlineRejected,
  });

  const entriesRequestId = snapshot?.requestId ?? null;
  const paged = useSessionPaginatedQuery(
    api.repositoryLedger.listEntries,
    entriesRequestId ? { requestId: entriesRequestId } : 'skip',
    { initialNumItems: LEDGER_PAGE_SIZE }
  );
  const pageStatus = paged?.status;
  const loadMore = paged?.loadMore;
  useEffect(() => {
    if (pageStatus === 'CanLoadMore' && loadMore) loadMore(LEDGER_PAGE_SIZE);
  }, [pageStatus, loadMore]);

  return {
    view,
    snapshot,
    entries: paged?.results ?? [],
    isLoadingPages: snapshot !== null && pageStatus !== 'Exhausted',
    request,
    cancel,
  };
}
