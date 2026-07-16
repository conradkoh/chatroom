'use client';

// fallow-ignore-file complexity

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AgenticQueryConfigBar } from './AgenticQueryConfigBar';
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

type AgenticTurn = {
  _id: string;
  seq: number;
  userMessage: string;
  assistantResponse?: string;
  createdAt: number;
};

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

function AgenticTurnBlock({
  turn,
  isLatest,
  isRunning,
  harnessSessionId,
}: {
  turn: AgenticTurn;
  isLatest: boolean;
  isRunning: boolean;
  harnessSessionId?: Id<'chatroom_harnessSessions'>;
}) {
  const showStreaming = isLatest && isRunning && !turn.assistantResponse && harnessSessionId;

  return (
    <div
      className="space-y-2"
      data-testid={isLatest ? 'agentic-query-latest-turn' : 'agentic-query-history-turn'}
    >
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
      ) : showStreaming ? (
        <>
          <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted pt-2">
            Agent
          </div>
          <AgenticStreamingBody harnessSessionId={harnessSessionId} />
        </>
      ) : null}
    </div>
  );
}

// fallow-ignore-next-line complexity
export function AgenticQueryPanel({
  queryId,
  mode: _mode,
  workspaceId,
  onMetaChange,
  focusToken,
}: AgenticQueryPanelProps) {
  const [composerText, setComposerText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastMetaRef = useRef<{ title: string; mode: AgenticQueryMode } | null>(null);

  const { query, turns, isRunning, canSubmit, canFollowUp, harnessSessionId, submit, isLoading } =
    useAgenticQuery(queryId);

  const harnessSelection = useAgenticQueryHarnessSelection(workspaceId);
  const harnessControlsDisabled = isRunning || isSubmitting;
  const isFollowUpMode = canFollowUp && turns.length > 0;
  const canCompose = isFollowUpMode ? canFollowUp : canSubmit;

  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const olderTurns = turns.length > 1 ? turns.slice(0, -1).reverse() : [];

  useEffect(() => {
    if (!query?.title || !onMetaChange) return;
    const next = { title: query.title, mode: query.mode };
    const prev = lastMetaRef.current;
    if (prev?.title === next.title && prev?.mode === next.mode) return;
    lastMetaRef.current = next;
    onMetaChange(next);
  }, [onMetaChange, query?.title, query?.mode]);

  useEffect(() => {
    if (isDraftLike(query?.status) && composerRef.current) {
      composerRef.current.focus();
    }
  }, [query?.status]);

  useEffect(() => {
    if (focusToken === undefined || focusToken <= 0) return;
    composerRef.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    if (!canFollowUp) return;
    composerRef.current?.focus();
  }, [canFollowUp]);

  const handleCompose = useCallback(async () => {
    const message = composerText.trim();
    if (!message || !canCompose || !harnessSelection.selectionReady) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submit(message, harnessSelection.toSubmitSelection());
      setComposerText('');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : isFollowUpMode
            ? 'Failed to submit follow-up'
            : 'Failed to submit query'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [canCompose, composerText, harnessSelection, isFollowUpMode, submit]);

  const adjustComposerHeight = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustComposerHeight();
  }, [composerText, adjustComposerHeight]);

  const handleComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter') return;
      if (isModEnterKey(e)) return;
      e.preventDefault();
      void handleCompose();
    },
    [handleCompose]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="agentic-query-panel">
      <AgenticQueryHarnessSync
        queryId={queryId as Id<'chatroom_agenticQueries'>}
        queryStatus={query?.status}
        harnessSessionId={harnessSessionId}
      />

      <div
        className="shrink-0 p-4 gap-4 flex flex-col border-b border-chatroom-border bg-chatroom-bg-primary"
        data-testid="agentic-query-composer"
      >
        <div className="flex items-center gap-2">
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
          <p className="text-xs text-red-500">{query.summary}</p>
        ) : null}

        <AgenticQueryConfigBar
          harnesses={harnessSelection.harnesses}
          harnessName={harnessSelection.harnessName}
          selectedModel={harnessSelection.selectedModel}
          providers={harnessSelection.providers}
          isModelHidden={harnessSelection.isModelHidden}
          favorites={harnessSelection.favorites}
          currentEntry={harnessSelection.currentEntry}
          disabled={harnessControlsDisabled}
          onApplyConfig={harnessSelection.applyConfig}
          onAddFavorite={harnessSelection.addFavorite}
          onRemoveFavorite={harnessSelection.removeFavorite}
          onMoveFavorite={harnessSelection.moveFavorite}
          isFavorite={harnessSelection.isFavorite}
          onHarnessChange={harnessSelection.setHarnessName}
          onModelChange={harnessSelection.setSelectedModel}
          filter={harnessSelection.filter}
        />

        <textarea
          ref={composerRef}
          rows={1}
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={
            isFollowUpMode
              ? 'Ask a follow-up or refine the results…'
              : 'Search or ask about the codebase… (e.g. "how does authentication work?")'
          }
          className="min-h-[2.5rem] max-h-48 w-full resize-none overflow-hidden bg-chatroom-bg-tertiary border border-chatroom-border px-3 py-2 text-[13px] text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none focus:border-chatroom-accent font-mono leading-normal"
          data-testid="agentic-query-composer-input"
        />

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-chatroom-text-muted">
            {isFollowUpMode
              ? 'Enter to follow up · ⌘Enter for new line'
              : 'Enter to search · ⌘Enter for new line'}
          </span>
          <button
            type="button"
            data-testid={isFollowUpMode ? 'agentic-query-follow-up' : 'agentic-query-submit'}
            disabled={
              !canCompose ||
              isSubmitting ||
              !composerText.trim() ||
              isLoading ||
              !harnessSelection.selectionReady
            }
            onClick={() => void handleCompose()}
            className={
              isFollowUpMode
                ? 'bg-chatroom-bg-tertiary text-chatroom-text-primary text-[10px] font-bold uppercase tracking-wider py-2 px-4 rounded-sm border border-chatroom-border disabled:opacity-50'
                : 'bg-chatroom-accent text-white text-[10px] font-bold uppercase tracking-wider py-2 px-4 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            {isSubmitting
              ? isFollowUpMode
                ? 'Sending…'
                : 'Submitting…'
              : isFollowUpMode
                ? 'Follow up'
                : 'Search'}
          </button>
        </div>

        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
        data-testid="agentic-query-results"
      >
        {turns.length === 0 && !isLoading ? (
          <span className="text-xs text-chatroom-text-muted">
            Type a query and submit to get started
          </span>
        ) : null}

        {latestTurn ? (
          <AgenticTurnBlock
            turn={latestTurn}
            isLatest
            isRunning={isRunning}
            harnessSessionId={harnessSessionId}
          />
        ) : null}

        {olderTurns.map((turn) => (
          <AgenticTurnBlock
            key={turn._id}
            turn={turn}
            isLatest={false}
            isRunning={false}
            harnessSessionId={harnessSessionId}
          />
        ))}
      </div>
    </div>
  );
}

function isDraftLike(status: string | undefined): boolean {
  return status === 'draft' || status === undefined;
}
