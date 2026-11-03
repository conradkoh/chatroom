'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { AlertTriangle, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { FileManagerList } from './FileManagerList';
import { PurgeFilesDialog } from './PurgeFilesDialog';
import { StorageQuotaForm } from './StorageQuotaForm';
import { StorageUsageBar } from './StorageUsageBar';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { BYTES_PER_MB, formatFileSize } from '../lib/formatFileSize';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export type FileStorageScope =
  { kind: 'user' } | { kind: 'chatroom'; chatroomId: Id<'chatroom_rooms'> };

interface NormalisedStorage {
  quotaBytes: number;
  isDefault: boolean;
  platformMaxBytes: number;
  usedBytes: number;
  fileCount: number;
  /** The quota that actually applies: the chatroom cap can win over the quota. */
  effectiveLimitBytes: number;
  /** Chatroom only: the user quota that caps the effective limit. */
  capBytes?: number;
}

function sectionLabel(scope: FileStorageScope): string {
  return scope.kind === 'user' ? 'Account file storage' : 'Chatroom file storage';
}

function overLimitCopy(usedBytes: number, effectiveLimitBytes: number): string {
  return `Over the limit by ${formatFileSize(usedBytes - effectiveLimitBytes)}. Removing the oldest files in the background…`;
}

/**
 * One storage scope. Renders the usage bar, eviction banner, quota form, purge
 * controls, and the shared file manager list.
 */
export function FileStoragePanel({ scope }: { scope: FileStorageScope }) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <section aria-label={sectionLabel(scope)} className="flex flex-col gap-4">
      <ErrorBoundary
        key={retryKey}
        fallback={
          <div className="flex items-center gap-2 text-xs text-chatroom-text-secondary">
            <AlertTriangle size={12} className="text-chatroom-status-error" />
            <span>Storage settings couldn&apos;t be loaded.</span>
            <Button variant="outline" size="xs" onClick={() => setRetryKey((key) => key + 1)}>
              <RotateCw size={12} />
              Retry
            </Button>
          </div>
        }
      >
        <StoragePanelContent scope={scope} />
      </ErrorBoundary>
    </section>
  );
}

interface UserStorageView {
  quotaBytes: number;
  isDefault: boolean;
  platformMaxQuotaBytes: number;
  usage: { bytes: number; fileCount: number };
}

interface ChatroomStorageView extends UserStorageView {
  userQuotaBytes: number;
  effectiveQuotaBytes: number;
}

function normaliseUserStorage(data: UserStorageView): NormalisedStorage {
  return {
    quotaBytes: data.quotaBytes,
    isDefault: data.isDefault,
    platformMaxBytes: data.platformMaxQuotaBytes,
    usedBytes: data.usage.bytes,
    fileCount: data.usage.fileCount,
    effectiveLimitBytes: data.quotaBytes,
  };
}

function normaliseChatroomStorage(data: ChatroomStorageView): NormalisedStorage {
  return {
    quotaBytes: data.quotaBytes,
    isDefault: data.isDefault,
    platformMaxBytes: data.platformMaxQuotaBytes,
    usedBytes: data.usage.bytes,
    fileCount: data.usage.fileCount,
    effectiveLimitBytes: data.effectiveQuotaBytes,
    capBytes: data.userQuotaBytes,
  };
}

function pickUserStorage(data: UserStorageView | undefined): NormalisedStorage | undefined {
  if (!data) return undefined;
  return normaliseUserStorage(data);
}

function pickChatroomStorage(data: ChatroomStorageView | undefined): NormalisedStorage | undefined {
  if (!data) return undefined;
  return normaliseChatroomStorage(data);
}

function useNormalisedStorage(scope: FileStorageScope): NormalisedStorage | undefined {
  const userStorage = useSessionQuery(
    api.fileStorageSettings.getUserFileStorage,
    scope.kind === 'user' ? {} : 'skip'
  );
  const chatroomStorage = useSessionQuery(
    api.fileStorageSettings.getChatroomFileStorage,
    scope.kind === 'chatroom' ? { chatroomId: scope.chatroomId } : 'skip'
  );

  return scope.kind === 'user'
    ? pickUserStorage(userStorage)
    : pickChatroomStorage(chatroomStorage);
}

/** Skeletons keep the bar/form layout stable while the query resolves. */
function StoragePanelSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading storage settings">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-2 w-full rounded-none" />
      </div>
      <Skeleton className="h-8 w-32 rounded-none" />
    </div>
  );
}

interface ActivePurge {
  minSizeBytes: number;
  deletedSoFar: number;
}

function chatroomIdOf(scope: FileStorageScope): Id<'chatroom_rooms'> | undefined {
  return scope.kind === 'chatroom' ? scope.chatroomId : undefined;
}

function scopeLabelOf(scope: FileStorageScope): 'this chatroom' | 'your account' {
  return scope.kind === 'user' ? 'your account' : 'this chatroom';
}

function deletedCopy(count: number): string {
  return count === 1 ? 'Deleted 1 file' : `Deleted ${count} files`;
}

function purgeWatchArgs(
  activePurge: ActivePurge | null,
  sessionId: string | undefined,
  chatroomId: Id<'chatroom_rooms'> | undefined
) {
  if (!activePurge || !sessionId) return 'skip' as const;
  return {
    sessionId,
    sort: 'largest' as const,
    ...(chatroomId ? { chatroomId } : {}),
  };
}

function firstBelowThreshold(results: { sizeBytes: number }[], minSizeBytes: number): boolean {
  const top = results[0];
  return top === undefined || top.sizeBytes < minSizeBytes;
}

function purgeDrained(activePurge: ActivePurge | null, status: string, results: unknown): boolean {
  if (!activePurge || status === 'LoadingFirstPage') return false;
  return firstBelowThreshold(results as { sizeBytes: number }[], activePurge.minSizeBytes);
}

/**
 * Watches the largest remaining file. Once nothing is left at or above the
 * threshold the server-side continuation has drained the purge, so the banner
 * clears and the user gets a final toast.
 */
function usePurgeCompletion(
  activePurge: ActivePurge | null,
  chatroomId: Id<'chatroom_rooms'> | undefined,
  onFinished: () => void
) {
  const [sessionId] = useSessionId();
  const first = usePaginatedQuery(
    api.fileAttachments.listFiles as PaginatedQueryReference,
    purgeWatchArgs(activePurge, sessionId, chatroomId),
    { initialNumItems: 1 }
  );
  const { status, results } = first;

  useEffect(() => {
    if (purgeDrained(activePurge, status, results)) onFinished();
  }, [activePurge, status, results, onFinished]);
}

function PurgeControls({
  minSize,
  onMinSizeChange,
  fileCount,
  purgeActive,
  onOpen,
}: {
  minSize: number;
  onMinSizeChange: (bytes: number) => void;
  fileCount: number;
  purgeActive: boolean;
  onOpen: () => void;
}) {
  const disabled = fileCount === 0 || purgeActive;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
        Free up space
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-chatroom-text-muted">Files larger than</span>
        <Select<number> value={minSize} onValueChange={(value) => onMinSizeChange(value ?? 0)}>
          <SelectTrigger className="h-8 w-32 rounded-none text-xs" aria-label="Files larger than">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={0}>Any size</SelectItem>
            <SelectItem value={BYTES_PER_MB}>1 MB</SelectItem>
            <SelectItem value={5 * BYTES_PER_MB}>5 MB</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="destructive" size="sm" disabled={disabled} onClick={onOpen}>
          <Trash2 size={12} />
          Purge files…
        </Button>
      </div>
    </div>
  );
}

function PurgeProgressBanner({ activePurge }: { activePurge: ActivePurge }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 border border-chatroom-status-info/40 bg-chatroom-status-info/10 px-2 py-1.5 text-[11px] text-chatroom-status-info"
    >
      <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />
      <span>Purge in progress. {activePurge.deletedSoFar} files deleted so far…</span>
    </div>
  );
}

function useStorageSave(
  scope: FileStorageScope,
  setUserQuota: (args: { quotaBytes: number }) => Promise<{ evictionScheduled: boolean }>,
  setChatroomQuota: (args: {
    chatroomId: Id<'chatroom_rooms'>;
    quotaBytes: number;
  }) => Promise<{ evictionScheduled: boolean }>
) {
  return useCallback(
    async (quotaBytes: number) => {
      if (scope.kind === 'user') return setUserQuota({ quotaBytes });
      return setChatroomQuota({ chatroomId: scope.chatroomId, quotaBytes });
    },
    [scope, setChatroomQuota, setUserQuota]
  );
}

function usePurgedHandler(
  purgeMinSize: number,
  setActivePurge: (purge: ActivePurge | null) => void
) {
  return useCallback(
    (result: { deleted: number; continuing: boolean }) => {
      if (result.continuing) {
        setActivePurge({ minSizeBytes: purgeMinSize, deletedSoFar: result.deleted });
        return;
      }
      toast.success(deletedCopy(result.deleted));
    },
    [purgeMinSize, setActivePurge]
  );
}

function StoragePanelContent({ scope }: { scope: FileStorageScope }) {
  const storage = useNormalisedStorage(scope);
  const setUserQuota = useSessionMutation(api.fileStorageSettings.setUserFileStorageQuota);
  const setChatroomQuota = useSessionMutation(api.fileStorageSettings.setChatroomFileStorageQuota);
  const [purgeMinSize, setPurgeMinSize] = useState(0);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [activePurge, setActivePurge] = useState<ActivePurge | null>(null);
  const chatroomId = chatroomIdOf(scope);

  const finishPurge = useCallback(() => {
    toast.success('Purge finished');
    setActivePurge(null);
  }, []);

  usePurgeCompletion(activePurge, chatroomId, finishPurge);

  const handlePurged = usePurgedHandler(purgeMinSize, setActivePurge);
  const save = useStorageSave(scope, setUserQuota, setChatroomQuota);

  if (!storage) return <StoragePanelSkeleton />;

  const overLimit = storage.usedBytes > storage.effectiveLimitBytes;

  return (
    <div className="flex flex-col gap-4">
      {overLimit && (
        <div
          role="status"
          className="flex items-start gap-2 border border-chatroom-status-warning/40 bg-chatroom-status-warning/10 px-2 py-1.5 text-[11px] text-chatroom-status-warning"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{overLimitCopy(storage.usedBytes, storage.effectiveLimitBytes)}</span>
        </div>
      )}
      <StorageUsageBar
        usedBytes={storage.usedBytes}
        fileCount={storage.fileCount}
        limitBytes={storage.quotaBytes}
        effectiveLimitBytes={storage.effectiveLimitBytes}
        isDefault={storage.isDefault}
      />
      <StorageQuotaForm
        quotaBytes={storage.quotaBytes}
        platformMaxBytes={storage.platformMaxBytes}
        usedBytes={storage.usedBytes}
        capBytes={storage.capBytes}
        scopeLabel={scopeLabelOf(scope)}
        save={save}
      />
      <PurgeControls
        minSize={purgeMinSize}
        onMinSizeChange={setPurgeMinSize}
        fileCount={storage.fileCount}
        purgeActive={activePurge !== null}
        onOpen={() => setPurgeOpen(true)}
      />
      {activePurge && <PurgeProgressBanner activePurge={activePurge} />}
      <FileManagerList chatroomId={chatroomId} />
      <PurgeFilesDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        chatroomId={chatroomId}
        minSizeBytes={purgeMinSize}
        onPurged={handlePurged}
      />
    </div>
  );
}
