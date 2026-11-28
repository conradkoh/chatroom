'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  FOLDER_BROWSE_ERROR_CODES,
  FOLDER_BROWSE_NO_RESPONSE_MS,
  type FolderBrowseEntry,
  type FolderBrowseErrorCode,
} from '@workspace/shared/domain/folder-browse';
import { ConvexError } from 'convex/values';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage } from '@/lib/convexError';

/**
 * Remote folder browsing over the daemon (`api.folderBrowse.*`).
 *
 * One hook invocation owns at most one browse session. The web subscribes to the session header
 * (`get`) and its one listing (`getListing`) separately, so navigating never resends the listing.
 * The session is ephemeral: select and cancel delete it, unmount closes it, and an idle session
 * expires server-side. The selected path is never stored here.
 */

/** Delay between the last filter keystroke and the navigate that applies it. */
const FILTER_DEBOUNCE_MS = 300;

/** Backend codes that mean the session is gone; they map to `ended`, not to `error`. */
const SESSION_ENDED_CODES: ReadonlySet<string> = new Set([
  'FOLDER_BROWSE_EXPIRED',
  'FOLDER_BROWSE_NOT_FOUND',
]);

/** Daemon-visible error codes, as a set for membership checks. */
const FOLDER_BROWSE_CODE_SET: ReadonlySet<string> = new Set(FOLDER_BROWSE_ERROR_CODES);

const BROWSE_FAILED_MESSAGE = 'Failed to browse folder';

export type RemoteFolderBrowserPhase =
  'opening' | 'loading' | 'ready' | 'error' | 'no-response' | 'ended';

/** One listing as the UI renders it. `fellBack` is derived here and never stored server-side. */
export interface RemoteFolderBrowserListing {
  path: string;
  parentPath: string | null;
  requestedPath: string | null;
  entries: readonly FolderBrowseEntry[];
  dirCount: number;
  fileCount: number;
  hiddenCount: number;
  truncated: boolean;
  complete: boolean;
  selectable: boolean;
  /** True when the daemon listed the nearest existing ancestor instead of the requested path. */
  fellBack: boolean;
}

/**
 * Error codes the browser surfaces: daemon codes pass through, and `FOLDER_BROWSE_INVALID_PATH`
 * becomes the webapp-only `INVALID_PATH` so the UI can say the path is invalid instead of that the
 * folder could not be read.
 */
export type RemoteFolderBrowserErrorCode = FolderBrowseErrorCode | 'INVALID_PATH';

export interface RemoteFolderBrowserError {
  code: RemoteFolderBrowserErrorCode;
  message: string;
  path: string;
}

export interface RemoteFolderBrowserState {
  phase: RemoteFolderBrowserPhase;
  machineDisplayName: string | null;
  listing: RemoteFolderBrowserListing | null;
  /** A navigation is in flight and the previous listing is still on screen. */
  isNavigating: boolean;
  showHidden: boolean;
  filter: string;
  error: RemoteFolderBrowserError | null;
  navigate: (path: string) => void;
  goUp: () => void;
  goHome: () => void;
  setShowHidden: (value: boolean) => void;
  setFilter: (text: string) => void;
  retry: () => void;
  select: () => void;
  cancel: () => void;
}

interface BrowseHeaderView {
  state: 'pending' | 'ready' | 'error';
  pendingSince: number | null;
  expiresAt: number;
}

interface BrowseListingView {
  seq: number;
  requestedPath: string | null;
  path: string;
  parentPath: string | null;
  entries: FolderBrowseEntry[];
  dirCount: number;
  fileCount: number;
  hiddenCount: number;
  truncated: boolean;
  complete: boolean;
  selectable: boolean;
  listedAt: number;
}

/** Map the header plus local flags onto the UI phase. Order matters and follows the design. */
// fallow-ignore-next-line complexity
function derivePhase(input: {
  browseId: Id<'chatroom_folderBrowseSessions'> | null;
  endedLocally: boolean;
  header: BrowseHeaderView | null | undefined;
  hasListing: boolean;
  hasMutationError: boolean;
  now: number;
}): RemoteFolderBrowserPhase {
  if (!input.browseId) return 'opening';
  if (input.endedLocally) return 'ended';
  const { header } = input;
  if (header === null) return 'ended';
  if (header === undefined) return 'loading';
  if (input.now >= header.expiresAt) return 'ended';
  if (header.state === 'pending') {
    const expired =
      header.pendingSince !== null &&
      input.now - header.pendingSince >= FOLDER_BROWSE_NO_RESPONSE_MS;
    if (expired) return 'no-response';
    return input.hasListing ? 'ready' : 'loading';
  }
  if (header.state === 'error' || input.hasMutationError) return 'error';
  return 'ready';
}

function toBrowserListing(view: BrowseListingView): RemoteFolderBrowserListing {
  return {
    path: view.path,
    parentPath: view.parentPath,
    requestedPath: view.requestedPath,
    entries: view.entries,
    dirCount: view.dirCount,
    fileCount: view.fileCount,
    hiddenCount: view.hiddenCount,
    truncated: view.truncated,
    complete: view.complete,
    selectable: view.selectable,
    fellBack: view.requestedPath !== null && view.requestedPath !== view.path,
  };
}

/** The `code` of a ConvexError object payload, when present. */
function convexErrorCode(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  const code = (data as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Times at which a header changes phase without a new server write: the expiry, and the
 * no-response deadline while the browse is pending.
 */
function phaseDeadlines(header: BrowseHeaderView): number[] {
  if (header.state !== 'pending' || header.pendingSince === null) return [header.expiresAt];
  return [header.expiresAt, header.pendingSince + FOLDER_BROWSE_NO_RESPONSE_MS];
}

/** Daemon codes pass through; FOLDER_BROWSE_INVALID_PATH becomes INVALID_PATH; else READ_FAILED. */
function toFolderBrowseErrorCode(error: unknown): RemoteFolderBrowserErrorCode {
  const code = convexErrorCode(error);
  if (code === 'FOLDER_BROWSE_INVALID_PATH') return 'INVALID_PATH';
  if (code !== null && FOLDER_BROWSE_CODE_SET.has(code)) return code as FolderBrowseErrorCode;
  return 'READ_FAILED';
}

// fallow-ignore-next-line complexity
export function useRemoteFolderBrowser({
  machineId,
  machineDisplayName,
  onSelected,
}: {
  machineId: string | null;
  machineDisplayName: string | null;
  onSelected: (path: string) => void;
}): {
  browser: RemoteFolderBrowserState | null;
  open: (startPath: string) => Promise<void>;
  close: () => void;
} {
  const openSession = useSessionMutation(api.folderBrowse.open);
  const navigateSession = useSessionMutation(api.folderBrowse.navigate);
  const closeSession = useSessionMutation(api.folderBrowse.close);

  const [active, setActive] = useState(false);
  const [browseId, setBrowseId] = useState<Id<'chatroom_folderBrowseSessions'> | null>(null);
  const [showHidden, setShowHiddenState] = useState(false);
  const [filter, setFilterState] = useState('');
  const [mutationError, setMutationError] = useState<RemoteFolderBrowserError | null>(null);
  const [endedLocally, setEndedLocally] = useState(false);
  const [lastStartPath, setLastStartPath] = useState<string | null>(null);
  const [clock, setClock] = useState<number | null>(null);

  const header = useSessionQuery(api.folderBrowse.get, browseId ? { browseId } : 'skip');
  const listingView = useSessionQuery(
    api.folderBrowse.getListing,
    browseId ? { browseId } : 'skip'
  );

  // `clock` marks the last deadline timer fire; `now` never goes backwards.
  // `now` is the client clock while `expiresAt` and `pendingSince` are server times, so clock skew
  // can show `ended` or `no-response` early or late. Accepted tolerance: the server stays the
  // authority for expiry, and the next server write re-derives the phase.
  const now = Math.max(clock ?? 0, Date.now());
  const listing = listingView ? toBrowserListing(listingView) : null;
  const phase = derivePhase({
    browseId,
    endedLocally,
    header,
    hasListing: listing !== null,
    hasMutationError: mutationError !== null,
    now,
  });
  const isNavigating = header != null && header.state === 'pending' && listing !== null;
  const currentPath = listing?.path ?? header?.requestedPath ?? lastStartPath;

  const browseIdRef = useRef<Id<'chatroom_folderBrowseSessions'> | null>(null);
  const closeSessionRef = useRef(closeSession);
  const navigateToRef = useRef<
    (path: string | null, nextShowHidden: boolean, nextFilter: string) => void
  >(() => undefined);
  const latestParamsRef = useRef<{ path: string | null; showHidden: boolean }>({
    path: null,
    showHidden: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every open and close, so a slow open that was superseded never adopts its session.
  const generationRef = useRef(0);

  useEffect(() => {
    browseIdRef.current = browseId;
  }, [browseId]);

  useEffect(() => {
    closeSessionRef.current = closeSession;
  }, [closeSession]);

  // Re-render when the no-response or expiry deadline passes. Re-armed on every render.
  useEffect(() => {
    if (!active || !header) return;
    const upcoming = phaseDeadlines(header).filter((deadline) => deadline > now);
    if (upcoming.length === 0) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(...upcoming) - now);
    return () => clearTimeout(timer);
  }, [active, header, now]);

  const applySessionError = useCallback((error: unknown, path: string) => {
    const code = convexErrorCode(error);
    if (code !== null && SESSION_ENDED_CODES.has(code)) {
      setEndedLocally(true);
      return;
    }
    setMutationError({
      code: toFolderBrowseErrorCode(error),
      message: getErrorMessage(error, BROWSE_FAILED_MESSAGE),
      path,
    });
  }, []);

  const navigateTo = useCallback(
    (path: string | null, nextShowHidden: boolean, nextFilter: string) => {
      if (!browseId) return;
      setMutationError(null);
      const trimmedFilter = nextFilter.trim();
      void navigateSession({
        browseId,
        path,
        showHidden: nextShowHidden,
        filter: trimmedFilter === '' ? undefined : trimmedFilter,
      }).catch((error: unknown) => applySessionError(error, path ?? lastStartPath ?? '/'));
    },
    [applySessionError, browseId, navigateSession, lastStartPath]
  );

  useEffect(() => {
    navigateToRef.current = navigateTo;
    latestParamsRef.current = { path: currentPath, showHidden };
  }, [navigateTo, currentPath, showHidden]);

  const open = useCallback(
    // fallow-ignore-next-line complexity
    async (startPath: string) => {
      if (!machineId) throw new Error('Select a machine first');
      const trimmed = startPath.trim();
      const path = trimmed.startsWith('/') ? trimmed : null;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const previous = browseIdRef.current;
      browseIdRef.current = null;
      if (previous) void closeSession({ browseId: previous }).catch(() => undefined);

      generationRef.current += 1;
      const generation = generationRef.current;
      setActive(true);
      setBrowseId(null);
      setShowHiddenState(false);
      setFilterState('');
      setMutationError(null);
      setEndedLocally(false);
      setLastStartPath(path);
      setClock(null);

      try {
        const result = await openSession(path === null ? { machineId } : { machineId, path });
        if (generation !== generationRef.current) {
          void closeSession({ browseId: result.browseId }).catch(() => undefined);
          return;
        }
        browseIdRef.current = result.browseId;
        setBrowseId(result.browseId);
      } catch (error) {
        if (generation === generationRef.current) setActive(false);
        throw error;
      }
    },
    [closeSession, machineId, openSession]
  );

  const close = useCallback(() => {
    generationRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const id = browseIdRef.current;
    browseIdRef.current = null;
    if (id) void closeSession({ browseId: id }).catch(() => undefined);
    setBrowseId(null);
    setActive(false);
    setShowHiddenState(false);
    setFilterState('');
    setMutationError(null);
    setEndedLocally(false);
    setLastStartPath(null);
    setClock(null);
  }, [closeSession]);

  // Unmount closes the session; no state is written after unmount.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const id = browseIdRef.current;
      if (id) void closeSessionRef.current({ browseId: id }).catch(() => undefined);
    };
  }, []);

  const navigate = useCallback(
    (path: string) => navigateTo(path, showHidden, filter),
    [navigateTo, showHidden, filter]
  );

  const goUp = useCallback(() => {
    if (!listing || listing.parentPath === null) return;
    navigateTo(listing.parentPath, showHidden, filter);
  }, [listing, navigateTo, showHidden, filter]);

  const goHome = useCallback(() => {
    navigateTo(null, showHidden, filter);
  }, [navigateTo, showHidden, filter]);

  const setShowHidden = useCallback(
    (value: boolean) => {
      setShowHiddenState(value);
      navigateTo(currentPath, value, filter);
    },
    [navigateTo, currentPath, filter]
  );

  const setFilter = useCallback((text: string) => {
    setFilterState(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const params = latestParamsRef.current;
      navigateToRef.current(params.path, params.showHidden, text);
    }, FILTER_DEBOUNCE_MS);
  }, []);

  // A pending navigate with identical params is a server no-op, so a stuck session is reopened
  // rather than re-navigated. `ended` already covers a local end flag and a null header.
  // fallow-ignore-next-line complexity
  const retry = useCallback(() => {
    if (!active) return;
    const stuck = !browseId || phase === 'ended' || phase === 'no-response';
    if (stuck) {
      void open(currentPath ?? lastStartPath ?? '').catch(() => undefined);
      return;
    }
    navigateTo(currentPath, showHidden, filter);
  }, [active, browseId, phase, open, currentPath, lastStartPath, navigateTo, showHidden, filter]);

  const select = useCallback(() => {
    if (!listing || !listing.selectable) return;
    onSelected(listing.path);
    close();
  }, [listing, onSelected, close]);

  const browser: RemoteFolderBrowserState | null = active
    ? {
        phase,
        machineDisplayName,
        listing,
        isNavigating,
        showHidden,
        filter,
        error: header?.error ?? mutationError,
        navigate,
        goUp,
        goHome,
        setShowHidden,
        setFilter,
        retry,
        select,
        cancel: close,
      }
    : null;

  return { browser, open, close };
}
