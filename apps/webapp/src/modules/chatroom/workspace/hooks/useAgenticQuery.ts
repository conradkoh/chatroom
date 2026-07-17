'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import type { AgenticQueryHarnessSelection } from './useAgenticQueryHarnessSelection';

export interface AgenticQueryTurn {
  _id: string;
  seq: number;
  userMessage: string;
  assistantResponse?: string;
  structuredResult?: string;
  createdAt: number;
}

export interface AgenticQueryData {
  _id: string;
  workspaceId: string;
  status: 'draft' | 'pending' | 'running' | 'complete' | 'failed';
  mode: 'search' | 'ask';
  title: string;
  harnessSessionId?: string;
  activeRunId?: string;
  summary?: string;
  createdAt: number;
  lastActiveAt: number;
}

export function useAgenticQuery(queryId: string) {
  const data = useSessionQuery(api.web.agenticQuery.queries.get, {
    queryId: queryId as Id<'chatroom_agenticQueries'>,
  });

  const submitMutation = useSessionMutation(api.web.agenticQuery.mutations.submit);
  const submitFollowUpMutation = useSessionMutation(api.web.agenticQuery.mutations.submitFollowUp);

  const submit = useCallback(
    async (message: string, selection: AgenticQueryHarnessSelection) => {
      const harnessArgs = {
        harnessName: selection.harnessName,
        model: selection.model,
      };
      if (data?.query.status === 'draft') {
        return submitMutation({
          queryId: queryId as Id<'chatroom_agenticQueries'>,
          message,
          ...harnessArgs,
        });
      }
      return submitFollowUpMutation({
        queryId: queryId as Id<'chatroom_agenticQueries'>,
        message,
        ...harnessArgs,
      });
    },
    [data?.query.status, queryId, submitFollowUpMutation, submitMutation]
  );

  const isRunning = data?.query.status === 'running';
  const isDraft = data?.query.status === 'draft';

  const canFollowUp = data?.query.status === 'complete' || data?.query.status === 'failed';
  const canSubmit = isDraft || canFollowUp;

  const activeRunId = data?.query.activeRunId as Id<'chatroom_agenticQueryRuns'> | undefined;

  return useMemo(
    () => ({
      query: data?.query as AgenticQueryData | undefined,
      turns: (data?.turns ?? []) as AgenticQueryTurn[],
      isLoading: data === undefined,
      isRunning,
      isDraft,
      canFollowUp,
      canSubmit,
      activeRunId,
      submit,
    }),
    [activeRunId, canFollowUp, canSubmit, data, isDraft, isRunning, submit]
  );
}
