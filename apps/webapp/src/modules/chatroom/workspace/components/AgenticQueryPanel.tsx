'use client';

// fallow-ignore-file complexity

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AgenticQueryHarnessControls } from './AgenticQueryHarnessControls';
import { AgenticQueryHarnessSync } from './AgenticQueryHarnessSync';
import { isModEnterKey } from '../../utils/isModEnterKey';
import { useAgenticQuery } from '../hooks/useAgenticQuery';
import { useAgenticQueryHarnessSelection } from '../hooks/useAgenticQueryHarnessSelection';
import type { AgenticQueryMode } from '../hooks/useFileTabs';

import { TimelineMarkdownBody } from '@/modules/chatroom/components/timeline/TimelineMarkdownBody';
import { useHarnessTurnStore } from '@/modules/chatroom/direct-harness/hooks/useHarnessTurnStore';

export interface AgenticQueryPanelProps {
  queryId: string;
  mode: AgenticQueryMode;
  workspaceId: string;
  onMetaChange?: (meta: { title: string; mode: AgenticQueryMode }) => void;
  focusToken?: number;
}

function AgenticStreamingBody({
  harnessSessionId,
}: {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
}) {
  const { turns, streamingOverlay, isLoading } = useHarnessTurnStore(harnessSessionId);
  const latestAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
  const streamText = streamingOverlay?.textContent?.trim();
  const content = streamText || latestAssistant?.textContent?.trim();

  if (isLoading && !content) {
    return (
      <div className="flex items-center gap-2 text-xs text-chatroom-text-muted">
        <Loader2 className="size-3 animate-spin" />
        Agent is working…
      </div>
    );
  }

  if (!content) {
    return <p className="text-xs text-chatroom-text-muted">Waiting for agent response…</p>;
  }

  return <TimelineMarkdownBody content={content} />;
}

// fallow-ignore-next-line complexity
export function AgenticQueryPanel({
  queryId,
  mode: _mode,
  workspaceId,
  onMetaChange,
  focusToken,
}: AgenticQueryPanelProps) {
  const [queryText, setQueryText] = useState('');
  const [followUpText, setFollowUpText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  const lastMetaRef = useRef<{ title: string; mode: AgenticQueryMode } | null>(null);

  const { query, turns, isRunning, canSubmit, canFollowUp, harnessSessionId, submit, isLoading } =
    useAgenticQuery(queryId);

  const harnessSelection = useAgenticQueryHarnessSelection(workspaceId);
  const harnessControlsDisabled = isRunning || isSubmitting;

  useEffect(() => {
    if (!query?.title || !onMetaChange) return;
    const next = { title: query.title, mode: query.mode };
    const prev = lastMetaRef.current;
    if (prev?.title === next.title && prev?.mode === next.mode) return;
    lastMetaRef.current = next;
    onMetaChange(next);
  }, [onMetaChange, query?.title, query?.mode]);

  useEffect(() => {
    if (isDraftLike(query?.status) && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [query?.status]);

  useEffect(() => {
    if (focusToken === undefined || focusToken <= 0) return;
    if (canFollowUp && followUpRef.current) {
      followUpRef.current.focus();
      return;
    }
    textareaRef.current?.focus();
  }, [focusToken, canFollowUp]);

  useEffect(() => {
    if (!canFollowUp) return;
    followUpRef.current?.focus();
  }, [canFollowUp]);

  const handleSubmit = useCallback(async () => {
    const message = queryText.trim();
    if (!message || !canSubmit || !harnessSelection.selectionReady) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submit(message, harnessSelection.toSubmitSelection());
      setQueryText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit query');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, harnessSelection, queryText, submit]);

  const handleFollowUp = useCallback(async () => {
    const message = followUpText.trim();
    if (!message || !canFollowUp || !harnessSelection.selectionReady) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submit(message, harnessSelection.toSubmitSelection());
      setFollowUpText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit follow-up');
    } finally {
      setIsSubmitting(false);
    }
  }, [canFollowUp, followUpText, harnessSelection, submit]);

  const handleQueryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isModEnterKey(e)) return;
      e.preventDefault();
      void handleSubmit();
    },
    [handleSubmit]
  );

  const handleFollowUpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isModEnterKey(e)) return;
      e.preventDefault();
      void handleFollowUp();
    },
    [handleFollowUp]
  );

  const showInitialInput = !turns.length || query?.status === 'draft';

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4" data-testid="agentic-query-panel">
      <AgenticQueryHarnessSync
        queryId={queryId as Id<'chatroom_agenticQueries'>}
        queryStatus={query?.status}
        harnessSessionId={harnessSessionId}
      />
      <div className="flex items-center gap-2 shrink-0">
        {isRunning ? (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-chatroom-text-muted">
            <Loader2 className="size-3 animate-spin" />
            Running
          </span>
        ) : null}
        {query?.status === 'failed' ? (
          <span className="text-[10px] uppercase tracking-wider text-red-500">Failed</span>
        ) : null}
      </div>

      {query?.status === 'failed' && query.summary ? (
        <p className="text-xs text-red-500 shrink-0">{query.summary}</p>
      ) : null}

      {showInitialInput ? (
        <>
          <AgenticQueryHarnessControls
            harnesses={harnessSelection.harnesses}
            harnessName={harnessSelection.harnessName}
            onHarnessChange={harnessSelection.setHarnessName}
            providers={harnessSelection.providers}
            selectedModel={harnessSelection.selectedModel}
            onModelChange={harnessSelection.setSelectedModel}
            isModelHidden={harnessSelection.isModelHidden}
            disabled={harnessControlsDisabled}
          />
          <textarea
            ref={textareaRef}
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={handleQueryKeyDown}
            placeholder='Search or ask about the codebase… (e.g. "how does authentication work?")'
            className="min-h-[120px] w-full resize-none bg-chatroom-bg-tertiary border border-chatroom-border p-3 text-[13px] text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none focus:border-chatroom-accent font-mono"
          />
          <div className="flex items-center justify-between shrink-0">
            <span className="text-[10px] text-chatroom-text-muted">⌘Enter to search</span>
            <button
              type="button"
              data-testid="agentic-query-submit"
              disabled={
                !canSubmit ||
                isSubmitting ||
                !queryText.trim() ||
                isLoading ||
                !harnessSelection.selectionReady
              }
              onClick={() => void handleSubmit()}
              className="bg-chatroom-accent text-white text-[10px] font-bold uppercase tracking-wider py-2 px-4 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Submitting…' : 'Search'}
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="text-xs text-red-500">{error}</p> : null}

      <div className="flex-1 min-h-0 overflow-y-auto border border-chatroom-border rounded-sm p-3 space-y-4">
        {turns.length === 0 && !isLoading ? (
          <span className="text-xs text-chatroom-text-muted">
            Type a query and submit to get started
          </span>
        ) : null}

        {turns.map((turn) => (
          <div key={turn._id} className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              You
            </div>
            <p className="text-[13px] text-chatroom-text-primary whitespace-pre-wrap font-mono">
              {turn.userMessage}
            </p>
            {turn.assistantResponse ? (
              <>
                <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted pt-2">
                  Agent
                </div>
                <TimelineMarkdownBody content={turn.assistantResponse} />
              </>
            ) : isRunning && harnessSessionId ? (
              <>
                <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted pt-2">
                  Agent
                </div>
                <AgenticStreamingBody harnessSessionId={harnessSessionId} />
              </>
            ) : null}
          </div>
        ))}
      </div>

      {canFollowUp ? (
        <div className="shrink-0 space-y-2 border-t border-chatroom-border pt-3">
          <AgenticQueryHarnessControls
            harnesses={harnessSelection.harnesses}
            harnessName={harnessSelection.harnessName}
            onHarnessChange={harnessSelection.setHarnessName}
            providers={harnessSelection.providers}
            selectedModel={harnessSelection.selectedModel}
            onModelChange={harnessSelection.setSelectedModel}
            isModelHidden={harnessSelection.isModelHidden}
            disabled={harnessControlsDisabled}
          />
          <textarea
            ref={followUpRef}
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            onKeyDown={handleFollowUpKeyDown}
            placeholder="Ask a follow-up or refine the results…"
            className="min-h-[80px] w-full resize-none bg-chatroom-bg-tertiary border border-chatroom-border p-3 text-[13px] text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none focus:border-chatroom-accent font-mono"
          />
          <div className="flex items-center justify-between shrink-0">
            <span className="text-[10px] text-chatroom-text-muted">⌘Enter to follow up</span>
            <button
              type="button"
              data-testid="agentic-query-follow-up"
              disabled={isSubmitting || !followUpText.trim() || !harnessSelection.selectionReady}
              onClick={() => void handleFollowUp()}
              className="bg-chatroom-bg-tertiary text-chatroom-text-primary text-[10px] font-bold uppercase tracking-wider py-2 px-4 rounded-sm border border-chatroom-border disabled:opacity-50"
            >
              {isSubmitting ? 'Sending…' : 'Follow up'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isDraftLike(status: string | undefined): boolean {
  return status === 'draft' || status === undefined;
}
