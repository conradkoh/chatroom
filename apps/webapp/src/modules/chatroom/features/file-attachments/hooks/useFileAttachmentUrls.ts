/**
 * Resolves storage URLs for a message's attached files.
 *
 * `getFileUrls` is reactive: `url` flips to `null` once a file is deleted, so the
 * timeline row can turn into its "no longer available" state without a refetch.
 * Errors are intentionally not caught here — the nearest `ErrorBoundary` owns
 * the retry UI, which remounts this hook and re-subscribes.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

export type FileUrlState =
  { status: 'loading' } | { status: 'ready'; urlById: Map<string, string | null> };

/**
 * @param ids at most `FILE_ATTACHMENT_MAX_PER_HANDOFF` ids; the caller slices.
 */
export function useFileAttachmentUrls(ids: Id<'chatroom_fileAttachments'>[]): FileUrlState {
  // Join/split keeps the query args referentially stable across renders.
  const joinedIds = ids.join(',');
  const attachmentIds = useMemo(
    () => (joinedIds ? (joinedIds.split(',') as Id<'chatroom_fileAttachments'>[]) : []),
    [joinedIds]
  );

  const urls = useSessionQuery(
    api.fileAttachments.getFileUrls,
    attachmentIds.length > 0 ? { attachmentIds } : 'skip'
  );

  return useMemo(() => {
    if (attachmentIds.length === 0) {
      return { status: 'ready', urlById: new Map() };
    }
    if (!urls) return { status: 'loading' };
    return {
      status: 'ready',
      urlById: new Map(urls.map((entry) => [entry.attachmentId, entry.url])),
    };
  }, [attachmentIds.length, urls]);
}
