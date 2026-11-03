'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import { FileManagerList } from './FileManagerList';
import { StorageQuotaForm } from './StorageQuotaForm';
import { StorageUsageBar } from './StorageUsageBar';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { formatFileSize } from '../lib/formatFileSize';

import { Button } from '@/components/ui/button';
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

function chatroomIdOf(scope: FileStorageScope): Id<'chatroom_rooms'> | undefined {
  return scope.kind === 'chatroom' ? scope.chatroomId : undefined;
}

function overLimitCopy(usedBytes: number, effectiveLimitBytes: number): string {
  return `Over the limit by ${formatFileSize(usedBytes - effectiveLimitBytes)}. Removing the oldest files in the background…`;
}

/**
 * One storage scope. Renders the usage bar, eviction banner, quota form, and
 * the shared file manager list.
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

function StoragePanelContent({ scope }: { scope: FileStorageScope }) {
  const storage = useNormalisedStorage(scope);
  const setUserQuota = useSessionMutation(api.fileStorageSettings.setUserFileStorageQuota);
  const setChatroomQuota = useSessionMutation(api.fileStorageSettings.setChatroomFileStorageQuota);
  const chatroomId = chatroomIdOf(scope);

  const save = useCallback(
    async (quotaBytes: number) => {
      if (scope.kind === 'user') return setUserQuota({ quotaBytes });
      return setChatroomQuota({ chatroomId: scope.chatroomId, quotaBytes });
    },
    [scope, setChatroomQuota, setUserQuota]
  );

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
        scopeLabel={scope.kind === 'user' ? 'your account' : 'this chatroom'}
        save={save}
      />
      <FileManagerList chatroomId={chatroomId} />
    </div>
  );
}
