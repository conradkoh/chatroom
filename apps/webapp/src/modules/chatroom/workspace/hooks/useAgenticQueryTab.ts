'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { UseFileTabsReturn } from './useFileTabs';

const AGENTIC_DEFAULT_TITLE = 'Agentic Search';

export function useAgenticQueryTabOpener(
  workspaceId: string | undefined,
  fileTabs: UseFileTabsReturn,
  options?: {
    onFocusRequest?: () => void;
    onBeforeOpen?: () => void;
  }
) {
  const createDraft = useSessionMutation(api.web.agenticQuery.index.createDraft);

  const openTab = useCallback(async () => {
    if (!workspaceId) return;
    options?.onBeforeOpen?.();

    const { queryId } = await createDraft({
      workspaceId: workspaceId as Id<'chatroom_workspaces'>,
      mode: 'search',
    });
    fileTabs.openAgenticQueryTab(queryId, 'search', AGENTIC_DEFAULT_TITLE);
    options?.onFocusRequest?.();
  }, [workspaceId, createDraft, fileTabs, options?.onFocusRequest, options?.onBeforeOpen]);

  return { openTab };
}
