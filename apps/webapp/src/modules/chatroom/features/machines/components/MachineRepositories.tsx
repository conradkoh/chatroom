'use client';

import type { BulkCreateOutcome } from '@workspace/backend/src/domain/usecase/chatroom/create-chatrooms-for-working-dirs';
import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react';

import { BulkCreateButton } from './BulkCreateButton';
import { BulkCreateDialog } from './BulkCreateDialog';
import { LedgerNotice } from './LedgerNotice';
import { RepositoryBanners } from './RepositoryBanners';
import { RepositoryFilterBar } from './RepositoryFilterBar';
import { RepositoryRow, type RowCreateMessage } from './RepositoryRow';
import { useBulkCreateChatrooms } from '../hooks/useBulkCreateChatrooms';
import {
  useRepositoryLedger,
  type LedgerEntryView,
  type LedgerSnapshotMeta,
  type LedgerView,
  type UseRepositoryLedgerResult,
} from '../hooks/useRepositoryLedger';
import { bulkCreateDisabledReason, repositoryCount } from '../lib/bulkCreate';
import { formatLastSeen } from '../lib/machineDisplay';
import { getMachineErrorCopy } from '../lib/machineErrorCopy';
import { filterRepositories } from '../lib/repositoryFilter';

import { Button } from '@/components/ui/button';
import { VirtualizedScrollList } from '@/modules/chatroom/components/virtual-list';

const SECTION_HEADING_CLASS =
  'text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted';

const OFFLINE_COPY = 'Machine is offline. Start the daemon to load repositories.';
const NO_ROOTS_COPY = 'Add a project root above, then load repositories.';
const EXPIRED_COPY = 'That snapshot expired. Load it again.';
const INTRO_COPY =
  "Repositories are read from this machine's daemon when you ask. The list is a snapshot, not kept in sync.";
const TIMED_OUT_COPY = 'The daemon did not respond. It may need updating, or it went offline.';
const ALREADY_HAS_CHATROOM_COPY = 'This repository already has a chatroom.';
const CREATE_FAILED_COPY = 'Could not create the chatroom. Try again.';

/** Inline create outcomes keyed by repository path. */
type RowMessages = Readonly<Record<string, RowCreateMessage>>;

/** Inline copy for a create outcome; 'created' shows nothing because the row already flips. */
function createOutcomeMessage(outcome: BulkCreateOutcome): RowCreateMessage | undefined {
  if (outcome.outcome === 'skipped') return { text: ALREADY_HAS_CHATROOM_COPY, tone: 'status' };
  if (outcome.outcome === 'failed') {
    return { text: outcome.message || CREATE_FAILED_COPY, tone: 'alert' };
  }
  return undefined;
}

export interface MachineRepositoriesProps {
  machineId: string;
  displayName: string;
  connected: boolean | undefined;
  hasRoots: boolean | undefined;
  /** The machine's current project root paths; undefined while the roots query loads. */
  currentRootPaths?: readonly string[];
}

type IdleView = Extract<LedgerView, { kind: 'idle' }>;

/** Idle copy: the blocking condition wins, then expiry, then the neutral introduction. */
function idleCopy(view: IdleView): string {
  if (view.blockedBy === 'offline') return OFFLINE_COPY;
  if (view.blockedBy === 'no-roots') return NO_ROOTS_COPY;
  if (view.reason === 'expired') return EXPIRED_COPY;
  return INTRO_COPY;
}

function LedgerIdle({ view, onLoad }: { view: IdleView; onLoad: () => void }) {
  return (
    <div data-testid="ledger-idle" className="mt-3 space-y-3">
      <p className="text-xs text-chatroom-text-muted">{idleCopy(view)}</p>
      <Button
        data-testid="ledger-load"
        disabled={!view.canRequest}
        onClick={onLoad}
        className="h-9 bg-chatroom-accent px-4 text-xs font-bold uppercase tracking-wide text-chatroom-bg-primary hover:bg-chatroom-text-secondary"
      >
        Load repositories
      </Button>
    </div>
  );
}

function LedgerAsking({ displayName, onCancel }: { displayName: string; onCancel: () => void }) {
  return (
    <div data-testid="ledger-asking" className="mt-3 space-y-3">
      <div className="flex items-center gap-2 text-xs text-chatroom-text-primary">
        <Loader2 size={14} className="animate-spin text-chatroom-text-muted" aria-hidden />
        Asking daemon…
      </div>
      <p className="text-xs text-chatroom-text-muted">
        Waiting for {displayName} to scan its project roots.
      </p>
      <Button variant="outline" size="xs" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function rescanIssueCopy(
  issue: NonNullable<Extract<LedgerView, { kind: 'ready' }>['rescanIssue']>
) {
  if (issue.kind === 'timedOut')
    return 'The daemon did not respond. The previous list is still shown.';
  return `Rescan failed: ${issue.message}. The previous list is still shown.`;
}

function RescanButton({
  asking,
  disabled,
  onRescan,
}: {
  asking: boolean;
  disabled: boolean;
  onRescan: () => void;
}) {
  return (
    <Button
      data-testid="ledger-rescan"
      variant="outline"
      size="xs"
      disabled={disabled || asking}
      onClick={onRescan}
    >
      {asking ? (
        <>
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Asking daemon…
        </>
      ) : (
        <>
          <RefreshCw size={12} aria-hidden />
          Rescan
        </>
      )}
    </Button>
  );
}

function NoMatch({ filter, onClear }: { filter: string; onClear: () => void }) {
  return (
    <div data-testid="ledger-no-match" className="space-y-2">
      <p className="text-xs text-chatroom-text-muted">No repositories match “{filter.trim()}”.</p>
      <Button variant="outline" size="xs" onClick={onClear}>
        Clear filter
      </Button>
    </div>
  );
}

function LedgerHeader({
  summary,
  showRescan,
  rescan,
}: {
  summary: string;
  showRescan: boolean;
  rescan: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p data-testid="ledger-summary" className="font-mono text-[10px] text-chatroom-text-muted">
        {summary}
      </p>
      {showRescan && rescan}
    </div>
  );
}

/** Banners, the rescan-failure notice, and the page-loading progress line. */
function LedgerNotices({
  snapshot,
  connected,
  currentRootPaths,
  view,
  isLoadingPages,
  loadedCount,
}: {
  snapshot: LedgerSnapshotMeta;
  connected: boolean | undefined;
  currentRootPaths: readonly string[] | undefined;
  view: LedgerView;
  isLoadingPages: boolean;
  loadedCount: number;
}) {
  const rescanIssue = view.kind === 'ready' ? view.rescanIssue : undefined;
  return (
    <>
      <RepositoryBanners
        snapshot={snapshot}
        connected={connected}
        currentRootPaths={currentRootPaths}
      />
      {rescanIssue && <LedgerNotice>{rescanIssueCopy(rescanIssue)}</LedgerNotice>}
      {isLoadingPages && (
        <p data-testid="ledger-loading-pages" className="text-xs text-chatroom-text-muted">
          Loading repositories… {loadedCount} of {snapshot.totalCount}
        </p>
      )}
    </>
  );
}

function LedgerEmpty({ rescan }: { rescan: ReactNode }) {
  return (
    <div className="space-y-3">
      <p data-testid="ledger-empty" className="text-xs text-chatroom-text-muted">
        No git repositories found under your project roots.
      </p>
      {rescan}
    </div>
  );
}

interface RepositoryListSectionProps {
  entries: LedgerEntryView[];
  isLoadingPages: boolean;
  machineId: string;
  displayName: string;
  connected: boolean | undefined;
  creatingPath: string | null;
  createMessages: RowMessages;
  onCreate: (path: string) => void;
}

/** Filter, bulk create, and the virtualised list. Owns the filter and bulk-dialog state. */
function RepositoryListSection({
  entries,
  isLoadingPages,
  machineId,
  displayName,
  connected,
  creatingPath,
  createMessages,
  onCreate,
}: RepositoryListSectionProps) {
  const [filter, setFilter] = useState('');
  const [bulkPaths, setBulkPaths] = useState<string[] | null>(null);
  const bulkButtonRef = useRef<HTMLButtonElement>(null);
  // The list filters on the deferred value so typing stays responsive on large snapshots.
  const deferredFilter = useDeferredValue(filter);
  const visible = useMemo(
    () => filterRepositories(entries, deferredFilter),
    [entries, deferredFilter]
  );
  const bulkRows = visible.filter((entry) => !entry.hasChatroom);
  const bulkDisabledReason = bulkCreateDisabledReason({ connected, isLoadingPages });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <RepositoryFilterBar value={filter} onChange={setFilter} />
        </div>
        {visible.length > 0 && (
          <BulkCreateButton
            count={bulkRows.length}
            disabledReason={bulkDisabledReason}
            buttonRef={bulkButtonRef}
            onOpen={() => setBulkPaths(bulkRows.map((entry) => entry.path))}
          />
        )}
      </div>
      {visible.length === 0 ? (
        <NoMatch filter={deferredFilter} onClear={() => setFilter('')} />
      ) : (
        <VirtualizedScrollList
          items={visible}
          height="min(28rem, 60dvh)"
          estimateSize={() => 72}
          getItemKey={(_, entry) => entry.path}
          overscan={8}
          scrollResetKey={deferredFilter}
          renderItem={(entry) => (
            <RepositoryRow
              entry={entry}
              disabled={connected !== true}
              creating={creatingPath === entry.path}
              message={createMessages[entry.path]}
              onCreate={onCreate}
            />
          )}
        />
      )}
      {bulkPaths !== null && (
        <BulkCreateDialog
          machineId={machineId}
          displayName={displayName}
          paths={bulkPaths}
          onClose={() => {
            setBulkPaths(null);
            bulkButtonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

interface LedgerReadyProps {
  ledger: UseRepositoryLedgerResult;
  snapshot: LedgerSnapshotMeta;
  view: LedgerView;
  machineId: string;
  displayName: string;
  connected: boolean | undefined;
  currentRootPaths: readonly string[] | undefined;
  creatingPath: string | null;
  createMessages: RowMessages;
  onCreate: (path: string) => void;
}

function LedgerReady({
  ledger,
  snapshot,
  view,
  machineId,
  displayName,
  connected,
  currentRootPaths,
  creatingPath,
  createMessages,
  onCreate,
}: LedgerReadyProps) {
  const { entries, isLoadingPages } = ledger;
  const isEmpty = !isLoadingPages && entries.length === 0;
  const summary = `Snapshot from ${formatLastSeen(snapshot.generatedAt, Date.now())} · ${repositoryCount(snapshot.totalCount)} · not kept in sync`;
  const rescan = (
    <RescanButton
      asking={view.kind === 'asking'}
      disabled={connected !== true}
      onRescan={() => void ledger.request(true)}
    />
  );

  return (
    <div data-testid="ledger-ready" className="mt-3 space-y-3">
      <LedgerHeader summary={summary} showRescan={!isEmpty} rescan={rescan} />
      <LedgerNotices
        snapshot={snapshot}
        connected={connected}
        currentRootPaths={currentRootPaths}
        view={view}
        isLoadingPages={isLoadingPages}
        loadedCount={entries.length}
      />
      {isEmpty && <LedgerEmpty rescan={rescan} />}
      {entries.length > 0 && (
        <RepositoryListSection
          entries={entries}
          isLoadingPages={isLoadingPages}
          machineId={machineId}
          displayName={displayName}
          connected={connected}
          creatingPath={creatingPath}
          createMessages={createMessages}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

function RetryBlock({
  testId,
  message,
  tone,
  onRetry,
}: {
  testId: string;
  message: string;
  tone: 'warning' | 'error';
  onRetry: () => void;
}) {
  return (
    <div data-testid={testId} className="mt-3 space-y-3">
      <LedgerNotice tone={tone}>{message}</LedgerNotice>
      <Button variant="outline" size="xs" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The timed-out or failed view with a retry. Renders nothing for any other view. */
function LedgerRetry({ view, onRetry }: { view: LedgerView; onRetry: () => void }) {
  if (view.kind === 'timedOut') {
    return (
      <RetryBlock
        testId="ledger-timed-out"
        message={TIMED_OUT_COPY}
        tone="warning"
        onRetry={onRetry}
      />
    );
  }
  if (view.kind === 'failed') {
    return (
      <RetryBlock
        testId="ledger-failed"
        message={`Could not read repositories: ${view.message}`}
        tone="error"
        onRetry={onRetry}
      />
    );
  }
  return null;
}

interface LedgerBodyProps {
  ledger: UseRepositoryLedgerResult;
  machineId: string;
  displayName: string;
  connected: boolean | undefined;
  currentRootPaths: readonly string[] | undefined;
  creatingPath: string | null;
  createMessages: RowMessages;
  onCreate: (path: string) => void;
}

/** Picks the body for the ledger state: the snapshot when one is shown, else the no-snapshot view. */
function LedgerBody({
  ledger,
  machineId,
  displayName,
  connected,
  currentRootPaths,
  creatingPath,
  createMessages,
  onCreate,
}: LedgerBodyProps) {
  const { snapshot, view } = ledger;
  if (snapshot !== null) {
    return (
      <LedgerReady
        ledger={ledger}
        snapshot={snapshot}
        view={view}
        machineId={machineId}
        displayName={displayName}
        connected={connected}
        currentRootPaths={currentRootPaths}
        creatingPath={creatingPath}
        createMessages={createMessages}
        onCreate={onCreate}
      />
    );
  }
  if (view.kind === 'idle') {
    return <LedgerIdle view={view} onLoad={() => void ledger.request(false)} />;
  }
  if (view.kind === 'asking') {
    return <LedgerAsking displayName={displayName} onCancel={ledger.cancel} />;
  }
  return <LedgerRetry view={view} onRetry={() => void ledger.request(false)} />;
}

/**
 * Repositories section for one expanded machine card: a snapshot loaded on demand from the
 * machine's daemon, listed as fixed-height virtualised rows, with one chatroom per row.
 * The hook discards the requests this section created when it unmounts (collapse or navigation);
 * reused requests are left to their creator.
 */
export function MachineRepositories({
  machineId,
  displayName,
  connected,
  hasRoots,
  currentRootPaths,
}: MachineRepositoriesProps) {
  const ledger = useRepositoryLedger(machineId, { connected, hasRoots });
  const { createOne } = useBulkCreateChatrooms();
  const [creatingPath, setCreatingPath] = useState<string | null>(null);
  const [createMessages, setCreateMessages] = useState<RowMessages>({});

  const setCreateMessage = useCallback((path: string, message: RowCreateMessage | undefined) => {
    setCreateMessages((current) => {
      const next = { ...current };
      if (message === undefined) delete next[path];
      else next[path] = message;
      return next;
    });
  }, []);

  const handleCreate = useCallback(
    async (path: string) => {
      setCreatingPath(path);
      setCreateMessage(path, undefined);
      try {
        const outcome = await createOne(machineId, path);
        setCreateMessage(path, createOutcomeMessage(outcome));
      } catch (error) {
        setCreateMessage(path, {
          text: getMachineErrorCopy(error, CREATE_FAILED_COPY),
          tone: 'alert',
        });
      } finally {
        setCreatingPath(null);
      }
    },
    [createOne, machineId, setCreateMessage]
  );

  return (
    <div>
      <h3 className={SECTION_HEADING_CLASS}>Repositories</h3>
      <LedgerBody
        ledger={ledger}
        machineId={machineId}
        displayName={displayName}
        connected={connected}
        currentRootPaths={currentRootPaths}
        creatingPath={creatingPath}
        createMessages={createMessages}
        onCreate={handleCreate}
      />
    </div>
  );
}
