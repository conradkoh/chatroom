'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { AgenticQueryMode, UseFileTabsReturn } from './useFileTabs';
import { editorTabKey } from './useFileTabs';

export const AGENTIC_DEFAULT_TITLE: Record<AgenticQueryMode, string> = {
  search: 'Agentic Search',
  ask: 'Agentic Ask',
};

export function useAgenticQueryTabOpener(
  workspaceId: string | undefined,
  fileTabs: UseFileTabsReturn,
  options?: {
    onFocusRequest?: () => void;
    onBeforeOpen?: () => void;
  }
) {
  const createDraft = useSessionMutation(api.web.agenticQuery.index.createDraft);

  const openTab = useCallback(
    async (mode: AgenticQueryMode) => {
      if (!workspaceId) return;
      options?.onBeforeOpen?.();

      const active =
        (fileTabs.tabs ?? []).find((t) => editorTabKey(t) === fileTabs.activeTabKey) ?? null;

      if (active?.kind === 'agentic-query') {
        options?.onFocusRequest?.();
        return;
      }

      const defaultTitle = AGENTIC_DEFAULT_TITLE[mode];
      const reusable = (fileTabs.tabs ?? []).find(
        (t): t is Extract<typeof t, { kind: 'agentic-query' }> =>
          t.kind === 'agentic-query' && t.mode === mode && t.name === defaultTitle
      );
      if (reusable) {
        fileTabs.openAgenticQueryTab(reusable.queryId, mode, reusable.name);
        options?.onFocusRequest?.();
        return;
      }

      const { queryId } = await createDraft({
        workspaceId: workspaceId as Id<'chatroom_workspaces'>,
        mode,
      });
      fileTabs.openAgenticQueryTab(queryId, mode, defaultTitle);
      options?.onFocusRequest?.();
    },
    [workspaceId, createDraft, fileTabs, options?.onFocusRequest, options?.onBeforeOpen]
  );

  const openSearchTab = useCallback(() => openTab('search'), [openTab]);
  const openAskTab = useCallback(() => openTab('ask'), [openTab]);

  return { openSearchTab, openAskTab };
}
