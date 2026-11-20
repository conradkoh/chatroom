'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { BulkCreateButton } from './BulkCreateButton';
import { BulkCreateDialog } from './BulkCreateDialog';
import { LedgerNotice } from './LedgerNotice';
import { RepositoryBanners } from './RepositoryBanners';
import { RepositoryFilterBar } from './RepositoryFilterBar';
import { RepositoryRow } from './RepositoryRow';
import { useBulkCreateChatrooms } from '../hooks/useBulkCreateChatrooms';
import {
  useRepositoryLedger,
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

interface LedgerReadyProps {
  ledger: UseRepositoryLedgerResult;
  snapshot: LedgerSnapshotMeta;
  view: LedgerView;
  machineId: string;
  displayName: string;
  connected: boolean | undefined;
  currentRootPaths: readonly string[] | undefined;
  creatingPath: string | null;
  onCreate: (path: string) => void;
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

// fallow-ignore-next-line complexity
function LedgerReady({
  ledger,
  snapshot,
  view,
  machineId,
  displayName,
  connected,
  currentRootPaths,
  creatingPath,
  onCreate,
}: LedgerReadyProps) {
  const [filter, setFilter] = useState('');
  const [bulkPaths, setBulkPaths] = useState<string[] | null>(null);
  const bulkButtonRef = useRef<HTMLButtonElement>(null);
  // The list filters on the deferred value so typing stays responsive on large snapshots.
  const deferredFilter = useDeferredValue(filter);
  const { entries, isLoadingPages } = ledger;
  const visible = useMemo(
    () => filterRepositories(entries, deferredFilter),
    [entries, deferredFilter]
  );
  const bulkRows = visible.filter((entry) => !entry.hasChatroom);
  const bulkDisabledReason = bulkCreateDisabledReason({ connected, isLoadingPages });
  const asking = view.kind === 'asking';
  const rescanIssue = view.kind === 'ready' ? view.rescanIssue : undefined;
  const isEmpty = !isLoadingPages && entries.length === 0;
  const summary = `Snapshot from ${formatLastSeen(snapshot.generatedAt, Date.now())} · ${repositoryCount(snapshot.totalCount)} · not kept in sync`;
  const rescan = (
    <RescanButton
      asking={asking}
      disabled={connected !== true}
      onRescan={() => void ledger.request(true)}
    />
  );

  return (
    <div data-testid="ledger-ready" className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="ledger-summary" className="font-mono text-[10px] text-chatroom-text-muted">
          {summary}
        </p>
        {!isEmpty && rescan}
      </div>

      <RepositoryBanners
        snapshot={snapshot}
        connected={connected}
        currentRootPaths={currentRootPaths}
      />

      {rescanIssue && <LedgerNotice>{rescanIssueCopy(rescanIssue)}</LedgerNotice>}

      {isLoadingPages && (
        <p data-testid="ledger-loading-pages" className="text-xs text-chatroom-text-muted">
          Loading repositories… {entries.length} of {snapshot.totalCount}
        </p>
      )}

      {isEmpty && (
        <div className="space-y-3">
          <p data-testid="ledger-empty" className="text-xs text-chatroom-text-muted">
            No git repositories found under your project roots.
          </p>
          {rescan}
        </div>
      )}

      {entries.length > 0 && (
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
                  onCreate={onCreate}
                />
              )}
            />
          )}
        </>
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

/**
 * Repositories section for one expanded machine card: a snapshot loaded on demand from the
 * machine's daemon, listed as fixed-height virtualised rows, with one chatroom per row.
 * The hook discards the snapshot when this component unmounts (collapse or navigation).
 */
// fallow-ignore-next-line complexity
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

  const handleCreate = useCallback(
    async (path: string) => {
      setCreatingPath(path);
      try {
        const outcome = await createOne(machineId, path);
        if (outcome.outcome === 'created') toast.success('Chatroom created');
        else if (outcome.outcome === 'skipped') toast('This repository already has a chatroom');
        else toast.error(outcome.message);
      } catch (error) {
        toast.error(getMachineErrorCopy(error, 'Could not create the chatroom. Try again.'));
      } finally {
        setCreatingPath(null);
      }
    },
    [createOne, machineId]
  );

  const { snapshot, view } = ledger;
  let body: ReactNode = null;
  if (snapshot !== null) {
    body = (
      <LedgerReady
        ledger={ledger}
        snapshot={snapshot}
        view={view}
        machineId={machineId}
        displayName={displayName}
        connected={connected}
        currentRootPaths={currentRootPaths}
        creatingPath={creatingPath}
        onCreate={handleCreate}
      />
    );
  } else if (view.kind === 'idle') {
    body = <LedgerIdle view={view} onLoad={() => void ledger.request(false)} />;
  } else if (view.kind === 'asking') {
    body = <LedgerAsking displayName={displayName} onCancel={ledger.cancel} />;
  } else if (view.kind === 'timedOut') {
    body = (
      <RetryBlock
        testId="ledger-timed-out"
        message={TIMED_OUT_COPY}
        tone="warning"
        onRetry={() => void ledger.request(false)}
      />
    );
  } else if (view.kind === 'failed') {
    body = (
      <RetryBlock
        testId="ledger-failed"
        message={`Could not read repositories: ${view.message}`}
        tone="error"
        onRetry={() => void ledger.request(false)}
      />
    );
  }

  return (
    <div>
      <h3 className={SECTION_HEADING_CLASS}>Repositories</h3>
      {body}
    </div>
  );
}
