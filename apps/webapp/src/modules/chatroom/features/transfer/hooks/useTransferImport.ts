/**
 * Chatroom import — the dialog's state machine.
 *
 * The file is read and validated in the browser and is never uploaded. Once a
 * selection exists, `runSelectedImports` writes one chunk at a time through
 * `chatroomImport.*` into the machine the caller fixed; this hook only tracks
 * what the dialog shows.
 *
 * Cancelling aborts the engine's signal and then waits for the run to settle, so
 * the rollback of the chatroom in progress finishes before the results appear.
 * Retrying re-selects only the entries that failed or never started: keys that
 * were imported stay marked, so a retry cannot create duplicates.
 *
 * The hook never throws; every failure is a state.
 */

'use client';

import {
  checkTransferFileSize,
  parseTransferFile,
  type TransferListing,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';
import {
  runSelectedImports,
  type EntryImportResult,
  type ImportRunEvent,
  type SelectedImportSummary,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-selection-driver';
import { useConvex } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import type { SessionId } from 'convex-helpers/server/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createImportPort } from '../lib/convexTransferPorts';
import { deriveImportRows, failedOrSkippedKeys, type CurrentImport } from '../lib/importRows';
import {
  clearInflightImport,
  INFLIGHT_IMPORT_HEARTBEAT_MS,
  touchInflightImport,
  writeInflightImport,
} from '../lib/inflightImport';
import { transferFailureOf } from '../lib/transferFailure';

export type ImportViewState =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string; progress: { done: number; total: number } | null }
  | { kind: 'rejected'; code: string; message: string; fileSizeBytes?: number }
  | {
      kind: 'listed';
      fileName: string;
      listing: TransferListing;
      selected: ReadonlySet<string>;
      machineId: string;
      /** Keys imported in an earlier run of this file. Never selectable again. */
      importedKeys: ReadonlySet<string>;
    }
  | {
      kind: 'importing';
      fileName: string;
      listing: TransferListing;
      keys: string[];
      machineId: string;
      importedKeys: ReadonlySet<string>;
      cancelling: boolean;
      current: CurrentImport | null;
      results: EntryImportResult[];
    }
  | {
      kind: 'done';
      fileName: string;
      listing: TransferListing;
      keys: string[];
      machineId: string;
      importedKeys: ReadonlySet<string>;
      summary: SelectedImportSummary;
    };

type ImportingState = Extract<ImportViewState, { kind: 'importing' }>;

export interface UseTransferImportResult {
  state: ImportViewState;
  loadFile(file: File): Promise<void>;
  toggle(key: string): void;
  selectAll(): void;
  clear(): void;
  start(): void;
  cancel(): Promise<void>;
  retryRemaining(): void;
  reset(): void;
}

// fallow-ignore-next-line complexity
export function useTransferImport(machineId: string): UseTransferImportResult {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const [state, setState] = useState<ImportViewState>({ kind: 'idle' });
  const readTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const runPromiseRef = useRef<Promise<void> | null>(null);

  // prettier-ignore
  // fallow-ignore-next-line complexity
  const loadFile = useCallback(async (file: File) => {
    const token = bumpToken(readTokenRef);
    const sizeFailure = checkTransferFileSize(file.size);
    if (sizeFailure !== null) {
      setState({
        kind: 'rejected',
        code: sizeFailure.code,
        message: sizeFailure.message,
        fileSizeBytes: file.size,
      });
      return;
    }

    setState({ kind: 'reading', fileName: file.name, progress: null });
    const text = await readText(file);
    if (text === null) {
      rejectUnreadable(token, readTokenRef, file.size, setState);
      return;
    }
    const parsed = await parseTransferFile(text, {
      onProgress: (done, total) => {
        setState((prev) =>
          prev.kind === 'reading' && token === readTokenRef.current
            ? { ...prev, progress: { done, total } }
            : prev
        );
      },
    });
    if (token !== readTokenRef.current) return;
    if (!parsed.ok) {
      setState({
        kind: 'rejected',
        code: parsed.code,
        message: parsed.message,
        fileSizeBytes: file.size,
      });
      return;
    }
    setState({
      kind: 'listed',
      fileName: file.name,
      listing: parsed.listing,
      selected: new Set(),
      machineId,
      importedKeys: new Set(),
    });
  }, [machineId]);

  const reset = useCallback(() => {
    bumpToken(readTokenRef);
    setState({ kind: 'idle' });
  }, []);

  const toggle = useCallback((key: string) => {
    setState((prev) => (prev.kind === 'listed' ? toggled(prev, key) : prev));
  }, []);

  const selectAll = useCallback(() => {
    setState((prev) => (prev.kind === 'listed' ? withAllSelected(prev) : prev));
  }, []);

  const clear = useCallback(() => {
    setState((prev) => (prev.kind === 'listed' ? { ...prev, selected: new Set<string>() } : prev));
  }, []);

  // fallow-ignore-next-line complexity
  const start = useCallback(() => {
    if (state.kind !== 'listed') return;
    const { fileName, listing, selected, machineId, importedKeys } = state;
    if (selected.size === 0 || sessionId === undefined) return;

    const keys = listing.entries.map((entry) => entry.key).filter((key) => selected.has(key));
    const controller = new AbortController();
    abortRef.current = controller;
    setState({
      kind: 'importing',
      fileName,
      listing,
      keys,
      machineId,
      importedKeys,
      cancelling: false,
      current: null,
      results: [],
    });

    const onEvent = (event: ImportRunEvent) => {
      recordInflight(event);
      setState((prev) => (prev.kind === 'importing' ? applyRunEvent(prev, event) : prev));
    };
    runPromiseRef.current = runImports(convex, sessionId, {
      listing,
      keys,
      machineId,
      signal: controller.signal,
      onEvent,
      setState,
    }).finally(() => {
      abortRef.current = null;
      runPromiseRef.current = null;
    });
  }, [convex, sessionId, state]);

  const cancel = useCallback(async (): Promise<void> => {
    const controller = abortRef.current;
    if (controller === null) return;
    setState((prev) => (prev.kind === 'importing' ? { ...prev, cancelling: true } : prev));
    controller.abort();
    await runPromiseRef.current;
  }, []);

  const retryRemaining = useCallback(() => {
    setState((prev) => (prev.kind === 'done' ? retryState(prev) : prev));
  }, []);

  useHeartbeat(state.kind === 'importing');

  useEffect(() => {
    if (state.kind !== 'importing') return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [state.kind]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    state,
    loadFile,
    toggle,
    selectAll,
    clear,
    start,
    cancel,
    retryRemaining,
    reset,
  };
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

function bumpToken(ref: { current: number }): number {
  ref.current += 1;
  return ref.current;
}

async function readText(file: File): Promise<string | null> {
  try {
    return await file.text();
  } catch {
    return null;
  }
}

function rejectUnreadable(
  token: number,
  readTokenRef: { current: number },
  fileSizeBytes: number,
  setState: (next: ImportViewState) => void
): void {
  if (token !== readTokenRef.current) return;
  setState({
    kind: 'rejected',
    code: 'IMPORT_FILE_UNREADABLE',
    message: 'The file could not be read.',
    fileSizeBytes,
  });
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

type ListedState = Extract<ImportViewState, { kind: 'listed' }>;

/** Only a valid entry that was not imported in an earlier run is selectable. */
function isSelectable(state: ListedState, key: string): boolean {
  const entry = state.listing.entries.find((candidate) => candidate.key === key);
  return entry !== undefined && entry.validity.ok && !state.importedKeys.has(key);
}

function toggled(state: ListedState, key: string): ListedState {
  if (!isSelectable(state, key)) return state;
  const selected = new Set(state.selected);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return { ...state, selected };
}

function withAllSelected(state: ListedState): ListedState {
  const selected = new Set(
    state.listing.entries.map((entry) => entry.key).filter((key) => isSelectable(state, key))
  );
  return { ...state, selected };
}

/** Retry re-selects the entries that failed or never started, never an imported one. */
function retryState(done: Extract<ImportViewState, { kind: 'done' }>): ListedState {
  const rows = deriveImportRows(done.listing, done.keys, null, done.summary.results, false);
  const selected = new Set(failedOrSkippedKeys(rows).filter((key) => !done.importedKeys.has(key)));
  return {
    kind: 'listed',
    fileName: done.fileName,
    listing: done.listing,
    selected,
    machineId: done.machineId,
    importedKeys: done.importedKeys,
  };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

interface RunArgs {
  listing: TransferListing;
  keys: string[];
  machineId: string;
  signal: AbortSignal;
  onEvent: (event: ImportRunEvent) => void;
  setState: (update: (prev: ImportViewState) => ImportViewState) => void;
}

/** Runs the selection, then lands in `done` whether the engine resolved or threw. */
function runImports(
  convex: ReturnType<typeof useConvex>,
  sessionId: SessionId,
  args: RunArgs
): Promise<void> {
  const port = createImportPort(convex, sessionId);
  return runSelectedImports(port, {
    listing: args.listing,
    keys: args.keys,
    machineId: args.machineId,
    dryRun: false,
    signal: args.signal,
    onEvent: args.onEvent,
  }).then(
    (summary) =>
      args.setState((prev) => (prev.kind === 'importing' ? doneState(prev, summary) : prev)),
    (error: unknown) =>
      args.setState((prev) =>
        prev.kind === 'importing' ? doneState(prev, fatalSummary(error)) : prev
      )
  );
}

function doneState(importing: ImportingState, summary: SelectedImportSummary): ImportViewState {
  const importedNow = summary.results.flatMap((result) =>
    result.status === 'imported' ? [result.key] : []
  );
  return {
    kind: 'done',
    fileName: importing.fileName,
    listing: importing.listing,
    keys: importing.keys,
    machineId: importing.machineId,
    importedKeys: new Set([...importing.importedKeys, ...importedNow]),
    summary,
  };
}

function fatalSummary(error: unknown): SelectedImportSummary {
  const failure = transferFailureOf(error);
  return {
    results: [],
    imported: 0,
    failed: 0,
    skipped: 0,
    cancelled: false,
    fatal: { code: failure.code, message: failure.message },
  };
}

// fallow-ignore-next-line complexity
function applyRunEvent(state: ImportingState, event: ImportRunEvent): ImportingState {
  switch (event.type) {
    case 'entry-started':
      return {
        ...state,
        current: {
          key: event.key,
          index: event.index,
          total: event.total,
          chunksDone: 0,
          chunksTotal: 0,
          chatroomId: null,
        },
      };
    case 'chatroom-created':
      return withCurrent(state, event.key, (current) => ({
        ...current,
        chatroomId: event.chatroomId,
      }));
    case 'chunk-applied':
      return withCurrent(state, event.key, (current) => ({
        ...current,
        chunksDone: event.done,
        chunksTotal: event.total,
      }));
    case 'entry-finished':
      return { ...state, current: null, results: [...state.results, event.result] };
  }
}

function withCurrent(
  state: ImportingState,
  key: string,
  update: (current: CurrentImport) => CurrentImport
): ImportingState {
  if (state.current === null || state.current.key !== key) return state;
  return { ...state, current: update(state.current) };
}

/**
 * A room exists on the server from `chatroom-created` until the entry settles.
 * A failed entry that kept its room (`orphanChatroomId`) leaves the record in
 * place so the interrupted-import notice can offer removal.
 */
// fallow-ignore-next-line complexity
function recordInflight(event: ImportRunEvent): void {
  if (event.type === 'chatroom-created') {
    writeInflightImport(event.chatroomId, Date.now());
    return;
  }
  if (event.type !== 'entry-finished') return;
  const { result } = event;
  if (
    result.status === 'imported' ||
    (result.status === 'failed' && result.orphanChatroomId === undefined)
  ) {
    clearInflightImport();
  }
}

function useHeartbeat(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => touchInflightImport(Date.now()), INFLIGHT_IMPORT_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [active]);
}
