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

/** A failed request call: the machine rejected it as offline, or it failed with copy to show. */
type RequestFailure = { kind: 'offline' } | { kind: 'error'; message: string };

interface LatestIds {
  askId: RequestId | null;
  shownId: RequestId | null;
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

interface LedgerPageState {
  results: LedgerEntryView[];
  status: string;
  loadMore: (numItems: number) => unknown;
}

function requestArgs(requestId: RequestId | null) {
  return requestId === null ? ('skip' as const) : { requestId };
}

function askIdOf(ask: AskState | null): RequestId | null {
  return ask === null ? null : ask.requestId;
}

function rescanOf(ask: AskState | null): boolean {
  return ask === null ? false : ask.rescan;
}

function requestIdOf(snapshot: LedgerSnapshotMeta | null): RequestId | null {
  return snapshot === null ? null : snapshot.requestId;
}

function snapshotGeneratedAt(row: CompletedRow): number {
  return row.ledgerGeneratedAt ?? row.completedAt ?? row.updatedAt;
}

function toSnapshotMeta(row: CompletedRow): LedgerSnapshotMeta {
  return {
    requestId: row._id,
    generatedAt: snapshotGeneratedAt(row),
    truncated: row.truncated === true,
    invalidPathCount: row.invalidPathCount ?? 0,
    roots: row.roots ?? [],
    totalCount: row.repositoryCount ?? 0,
  };
}

/** The displayed snapshot for a request row, or null while it loads, is unfinished, or has expired. */
function snapshotOf(
  row: LedgerRequestRow | null | undefined,
  now: number
): LedgerSnapshotMeta | null {
  if (!row || row.status !== 'completed' || row.expiresAt <= now) return null;
  return toSnapshotMeta(row as CompletedRow);
}

/** True when the displayed snapshot is gone (null row) or past its expiry; false while loading. */
function isSnapshotExpired(row: LedgerRequestRow | null | undefined, now: number): boolean {
  if (row === null) return true;
  return row?.status === 'completed' && row.expiresAt <= now;
}

function rowPhase(row: LedgerRequestRow, now: number): AskPhase {
  if (row.status === 'completed') return 'completed';
  if (row.status === 'failed') return 'failed';
  return row.expiresAt <= now ? 'timedOut' : 'asking';
}

/** Phase of an issued request: undefined row is still loading, null row is gone. */
function askPhaseOf(row: LedgerRequestRow | null | undefined, now: number): AskPhase {
  if (row === undefined) return 'asking';
  if (row === null) return 'missing';
  return rowPhase(row, now);
}

function derivePhase(
  ask: AskState | null,
  askRow: LedgerRequestRow | null | undefined,
  now: number
): AskPhase | null {
  if (ask === null) return null;
  if (ask.requestId === null) return 'starting';
  return askPhaseOf(askRow, now);
}

/** The request id of a completed ask waiting to be promoted, else null. */
function completedAskId(phase: AskPhase | null, ask: AskState | null): RequestId | null {
  if (phase !== 'completed' || ask === null) return null;
  return ask.requestId;
}

function blockedByOf(
  gate: LedgerGate,
  offlineRejected: boolean
): 'offline' | 'no-roots' | undefined {
  if (gate.connected === false || offlineRejected) return 'offline';
  if (gate.hasRoots === false) return 'no-roots';
  return undefined;
}

/** Build the ask-independent idle gate. Offline wins over missing roots. Omit `blockedBy` when unblocked. */
function idleGate(gate: LedgerGate, offlineRejected: boolean) {
  const blockedBy = blockedByOf(gate, offlineRejected);
  const canRequest = blockedBy === undefined && gate.connected === true && gate.hasRoots === true;
  return blockedBy === undefined ? { canRequest } : { canRequest, blockedBy };
}

/** The issue for a failed or timed-out ask, or null when the ask did not fail. */
function failedPhaseIssue(
  phase: AskPhase | null,
  askRow: LedgerRequestRow | null | undefined
): RescanIssue | null {
  if (phase === 'timedOut') return { kind: 'timedOut' };
  if (phase === 'failed') return { kind: 'failed', message: failedMessageOf(askRow) };
  if (phase === 'missing') return { kind: 'failed', message: RESCAN_EXPIRED_COPY };
  return null;
}

function failedMessageOf(askRow: LedgerRequestRow | null | undefined): string {
  return askRow?.errorMessage ?? DAEMON_FAILURE_FALLBACK_COPY;
}

/** The ask's failure, shown as a rescan issue when a snapshot is still displayed. */
function askFailure(input: DeriveViewInput): RescanIssue | null {
  const issue = failedPhaseIssue(input.phase, input.askRow);
  if (issue !== null) return issue;
  return input.callError === null ? null : { kind: 'failed', message: input.callError };
}

/** The view for a failed ask. A missing ask with no snapshot returns null and falls through to idle. */
function failedView(
  failure: RescanIssue,
  phase: AskPhase | null,
  snapshot: LedgerSnapshotMeta | null
): LedgerView | null {
  if (snapshot !== null) return { kind: 'ready', rescanIssue: failure };
  if (failure.kind === 'timedOut') return { kind: 'timedOut' };
  if (phase === 'missing') return null;
  return { kind: 'failed', message: failure.message };
}

/** The view for a failed ask or a displayed snapshot; null when the idle gate applies. */
function settledView(input: DeriveViewInput): LedgerView | null {
  const failure = askFailure(input);
  if (failure !== null) return failedView(failure, input.phase, input.snapshot);
  return input.snapshot === null ? null : { kind: 'ready' };
}

function idleView(input: DeriveViewInput): LedgerView {
  const expired = input.snapshotExpired || input.phase === 'missing';
  return {
    kind: 'idle',
    ...(expired ? { reason: 'expired' as const } : {}),
    ...idleGate(input.gate, input.offlineRejected),
  };
}

/**
 * Derive the view in order: asking, ask failure, displayed snapshot, then the idle gate.
 * A failing ask keeps the previous snapshot visible as a `ready` view with a `rescanIssue`.
 */
function deriveView(input: DeriveViewInput): LedgerView {
  if (input.phase === 'starting' || input.phase === 'asking') {
    return { kind: 'asking', rescan: input.rescan, hasPreviousSnapshot: input.snapshot !== null };
  }
  return settledView(input) ?? idleView(input);
}

function failureFieldsOf(failure: RequestFailure | null): {
  offlineRejected: boolean;
  callError: string | null;
} {
  return {
    offlineRejected: failure !== null && failure.kind === 'offline',
    callError: failure !== null && failure.kind === 'error' ? failure.message : null,
  };
}

function requestFailureOf(error: unknown): RequestFailure {
  if (getConvexErrorCode(error) === MACHINE_OFFLINE_CODE) return { kind: 'offline' };
  return { kind: 'error', message: getMachineErrorCopy(error, REQUEST_FALLBACK_COPY) };
}

/** The soonest deadline still in the future, or undefined. */
function nextDeadline(deadlines: readonly (number | undefined)[], now: number): number | undefined {
  const upcoming = deadlines.filter((t): t is number => t !== undefined && t > now);
  return upcoming.length === 0 ? undefined : Math.min(...upcoming);
}

/** Current time, re-rendered at the next deadline so pending→timed out and completed→expired flip without polling. */
function useDeadlineNow(deadlines: readonly (number | undefined)[]): number {
  const [now, setNow] = useState(() => Date.now());
  const target = nextDeadline(deadlines, now);
  useEffect(() => {
    if (target === undefined) return;
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), target)),
      Math.max(0, target - Date.now())
    );
    return () => clearTimeout(timer);
  }, [target]);
  return now;
}

/** Discards a request on the server. Failures are ignored; the request expires on its own. */
function useDiscardQuietly(): (requestId: RequestId) => void {
  const discardMutation = useSessionMutation(api.repositoryLedger.discard);
  // Kept in a ref so callers and the unmount cleanup always use the latest mutation.
  const discardRef = useRef<typeof discardMutation | null>(null);
  useEffect(() => {
    discardRef.current = discardMutation;
  });
  return useCallback((requestId: RequestId) => {
    const discard = discardRef.current;
    if (discard) void discard({ requestId }).catch(() => undefined);
  }, []);
}

function discardLatest(latest: LatestIds, discardQuietly: (requestId: RequestId) => void): void {
  if (latest.askId) discardQuietly(latest.askId);
  if (latest.shownId) discardQuietly(latest.shownId);
}

function useLedgerRows(askId: RequestId | null, shownId: RequestId | null) {
  const askRow = useSessionQuery(api.repositoryLedger.get, requestArgs(askId));
  const shownRow = useSessionQuery(api.repositoryLedger.get, requestArgs(shownId));
  const now = useDeadlineNow([askRow?.expiresAt, shownRow?.expiresAt]);
  return { askRow, shownRow, now };
}

function entriesOf(paged: LedgerPageState | undefined): LedgerEntryView[] {
  return paged?.results ?? [];
}

/** Loads every page of the displayed snapshot as soon as the previous page lands. */
function useLoadRemainingPages(paged: LedgerPageState | undefined): void {
  const status = paged?.status;
  const loadMore = paged?.loadMore;
  useEffect(() => {
    if (status === 'CanLoadMore' && loadMore) loadMore(LEDGER_PAGE_SIZE);
  }, [status, loadMore]);
}

function useLedgerPages(snapshot: LedgerSnapshotMeta | null) {
  const paged: LedgerPageState | undefined = useSessionPaginatedQuery(
    api.repositoryLedger.listEntries,
    requestArgs(requestIdOf(snapshot)),
    { initialNumItems: LEDGER_PAGE_SIZE }
  );
  useLoadRemainingPages(paged);
  return {
    entries: entriesOf(paged),
    isLoadingPages: snapshot !== null && paged?.status !== 'Exhausted',
  };
}

export function useRepositoryLedger(
  machineId: string,
  gate: LedgerGate
): UseRepositoryLedgerResult {
  const [ask, setAsk] = useState<AskState | null>(null);
  const [shownId, setShownId] = useState<RequestId | null>(null);
  const [requestFailure, setRequestFailure] = useState<RequestFailure | null>(null);
  const sequence = useRef(0);
  const latest = useRef<LatestIds>({ askId: null, shownId: null });
  const discardQuietly = useDiscardQuietly();
  const requestMutation = useSessionMutation(api.repositoryLedger.request);

  const askId = askIdOf(ask);
  const { askRow, shownRow, now } = useLedgerRows(askId, shownId);
  const phase = derivePhase(ask, askRow, now);
  const snapshot = snapshotOf(phase === 'completed' ? askRow : shownRow, now);
  const { entries, isLoadingPages } = useLedgerPages(snapshot);
  const view = deriveView({
    phase,
    rescan: rescanOf(ask),
    askRow,
    snapshot,
    snapshotExpired: isSnapshotExpired(shownRow, now),
    ...failureFieldsOf(requestFailure),
    gate,
  });

  useEffect(() => {
    latest.current = { askId, shownId };
  }, [askId, shownId]);

  // Promote a completed ask to the displayed snapshot; discard the one it replaces.
  useEffect(() => {
    const completedId = completedAskId(phase, ask);
    if (completedId === null) return;
    const previous = shownId;
    setShownId(completedId);
    setAsk(null);
    if (previous !== null && previous !== completedId) discardQuietly(previous);
  }, [phase, ask, shownId, discardQuietly]);

  // Unmount (collapse or leave the page) discards the snapshot and any pending ask.
  useEffect(
    () => () => {
      sequence.current += 1;
      discardLatest(latest.current, discardQuietly);
    },
    [discardQuietly]
  );

  const request = useCallback(
    async (rescan: boolean) => {
      const current = ++sequence.current;
      setRequestFailure(null);
      setAsk({ requestId: null, rescan });
      try {
        const { requestId } = await requestMutation({ machineId, rescan });
        if (current !== sequence.current) {
          discardQuietly(requestId);
          return;
        }
        setAsk({ requestId, rescan });
      } catch (error) {
        if (current === sequence.current) {
          setAsk(null);
          setRequestFailure(requestFailureOf(error));
        }
      }
    },
    [machineId, requestMutation, discardQuietly]
  );

  const cancel = useCallback(() => {
    sequence.current += 1;
    discardLatest(latest.current, discardQuietly);
    setAsk(null);
    setShownId(null);
    setRequestFailure(null);
  }, [discardQuietly]);

  return { view, snapshot, entries, isLoadingPages, request, cancel };
}
