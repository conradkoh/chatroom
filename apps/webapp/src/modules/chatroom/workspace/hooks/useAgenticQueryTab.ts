'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { UseFileTabsReturn } from './useFileTabs';

export function useAgenticQueryTabOpener(
  workspaceId: string | undefined,
  fileTabs: UseFileTabsReturn
) {
  const createDraft = useSessionMutation(api.web.agenticQuery.index.createDraft);

  const openSearchTab = useCallback(async () => {
    if (!workspaceId) return;
    const { queryId } = await createDraft({ workspaceId, mode: 'search' });
    fileTabs.openAgenticQueryTab(queryId, 'search', 'Agentic Search');
  }, [workspaceId, createDraft, fileTabs]);

  const openAskTab = useCallback(async () => {
    if (!workspaceId) return;
    const { queryId } = await createDraft({ workspaceId, mode: 'ask' });
    fileTabs.openAgenticQueryTab(queryId, 'ask', 'Agentic Ask');
  }, [workspaceId, createDraft, fileTabs]);

  return { openSearchTab, openAskTab };
}
