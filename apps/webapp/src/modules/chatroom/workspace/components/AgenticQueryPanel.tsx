'use client';

// fallow-ignore-file complexity

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ChevronDown, Loader2, Search, Send } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AgenticQueryConfigBar } from './AgenticQueryConfigBar';
import { AgenticQueryHarnessSync } from './AgenticQueryHarnessSync';
import { useRefreshCapabilities } from '../../direct-harness/hooks/useRefreshCapabilities';
import { isModEnterKey } from '../../utils/isModEnterKey';
import { useAgenticQuery } from '../hooks/useAgenticQuery';
import { useAgenticQueryHarnessSelection } from '../hooks/useAgenticQueryHarnessSelection';
import { useAgenticQueryRunTurnStore } from '../hooks/useAgenticQueryRunTurnStore';
import type { AgenticQueryMode } from '../hooks/useFileTabs';

import { cn } from '@/lib/utils';
import { FileReferenceAutocomplete } from '@/modules/chatroom/components/FileReferenceAutocomplete';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import { measureTextareaContentHeightPx } from '@/modules/chatroom/components/messageInputAutosize';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '@/modules/chatroom/components/shared/industrialDialogStyles';
import { TimelineMarkdownBody } from '@/modules/chatroom/components/timeline/TimelineMarkdownBody';
import { JUMP_TO_NEW_MESSAGES_GAP_PX } from '@/modules/chatroom/components/timeline/timelineVirtualizerConfig';
import { ThinkingBlock } from '@/modules/chatroom/direct-harness/components/ThinkingBlock';
import { useFileReferenceAutocomplete } from '@/modules/chatroom/hooks/useFileReferenceAutocomplete';
import { useScrollController } from '@/modules/chatroom/hooks/useScrollController';
import type { ScrollController } from '@/modules/chatroom/hooks/useScrollController';

export interface AgenticQueryPanelProps {
  queryId: string;
  mode: AgenticQueryMode;
  /** Convex registry workspace ID (harness selection, API calls). */
  workspaceId: string;
  /** Same merged file list as MessageInput @ autocomplete. */
  autocompleteFiles?: FileEntry[];
  hasAutocompleteWorkspace?: boolean;
  onAtTriggerActivate?: () => void;
  onMetaChange?: (meta: { title: string; mode: AgenticQueryMode }) => void;
  focusToken?: number;
  onUnavailable?: () => void;
}

type AgenticTurn = {
  _id: string;
  seq: number;
  userMessage: string;
  assistantResponse?: string;
  createdAt: number;
};

function AgenticStreamingBody({ runId }: { runId: Id<'chatroom_agenticQueryRuns'> }) {
  const { turns, streamingOverlay, isLoading } = useAgenticQueryRunTurnStore(runId);
  const latestAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
  const streamText = streamingOverlay?.textContent?.trim();
  const streamReasoning = streamingOverlay?.reasoningContent?.trim();
  const content = streamText || latestAssistant?.textContent?.trim();
  const reasoning = streamReasoning || latestAssistant?.reasoningContent?.trim();

  if (isLoading && !content && !reasoning) {
    return (
      <div className="flex items-center gap-2 text-xs text-chatroom-text-muted">
        <Loader2 className="size-3 animate-spin" />
        Agent is working…
      </div>
    );
  }

  if (!content && !reasoning) {
    return <p className="text-xs text-chatroom-text-muted">Waiting for agent response…</p>;
  }

  return (
    <div className="space-y-2">
      {reasoning ? <ThinkingBlock content={reasoning} /> : null}
      {content ? <TimelineMarkdownBody content={content} /> : null}
    </div>
  );
}

function AgenticTurnBlock({
  turn,
  isLatest,
  isRunning,
  activeRunId,
}: {
  turn: AgenticTurn;
  isLatest: boolean;
  isRunning: boolean;
  activeRunId?: Id<'chatroom_agenticQueryRuns'>;
}) {
  const showStreaming = isLatest && isRunning && !turn.assistantResponse && activeRunId;

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
          <AgenticStreamingBody runId={activeRunId} />
        </>
      ) : null}
    </div>
  );
}

function AgenticQueryStreamScrollSync({
  runId,
  controller,
  feedRef,
}: {
  runId: Id<'chatroom_agenticQueryRuns'>;
  controller: React.MutableRefObject<ScrollController>;
  feedRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { streamingOverlay } = useAgenticQueryRunTurnStore(runId);
  const prevScrollHeightRef = useRef(0);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const newScrollHeight = el.scrollHeight;
    const heightDiff = newScrollHeight - prevScrollHeightRef.current;
    if (heightDiff > 0 && prevScrollHeightRef.current > 0) {
      controller.current.onNewMessages(heightDiff, false, false);
    }
    prevScrollHeightRef.current = newScrollHeight;
  }, [streamingOverlay?.textContent, streamingOverlay?.reasoningContent, controller, feedRef]);

  return null;
}

// fallow-ignore-next-line complexity
export function AgenticQueryPanel({
  queryId,
  mode: _mode,
  workspaceId,
  autocompleteFiles = [],
  hasAutocompleteWorkspace = false,
  onAtTriggerActivate,
  onMetaChange,
  focusToken,
  onUnavailable,
}: AgenticQueryPanelProps) {
  const [composerText, setComposerText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastMetaRef = useRef<{ title: string; mode: AgenticQueryMode } | null>(null);

  const {
    query,
    turns,
    isRunning,
    canSubmit,
    canFollowUp,
    activeRunId,
    submit,
    isLoading,
    isNotFound,
  } = useAgenticQuery(queryId);

  useEffect(() => {
    if (isNotFound) {
      onUnavailable?.();
    }
  }, [isNotFound, onUnavailable]);

  const harnessSelection = useAgenticQueryHarnessSelection(workspaceId);
  const { refresh: refreshCapabilities } = useRefreshCapabilities();
  const harnessControlsDisabled = isRunning || isSubmitting;
  const isFollowUpMode = canFollowUp && turns.length > 0;
  const canCompose = isFollowUpMode ? canFollowUp : canSubmit;

  useEffect(() => {
    if (!workspaceId) return;
    refreshCapabilities(workspaceId as Id<'chatroom_workspaces'>);
  }, [workspaceId, refreshCapabilities]);

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
      const message = e instanceof Error ? e.message : '';
      const isMissing =
        message.includes('Agentic query not found') ||
        message.includes('NOT_FOUND') ||
        message.includes('no longer available');
      setError(
        isMissing
          ? 'This search session is no longer available.'
          : e instanceof Error
            ? e.message
            : isFollowUpMode
              ? 'Failed to submit follow-up'
              : 'Failed to submit query'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [canCompose, composerText, harnessSelection, isFollowUpMode, submit]);

  // ── Scroll controller ──────────────────────────────────────────────────
  const { controller, isPinned, scrollToBottom, beginResize, endResize } = useScrollController();
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const prevTurnCountRef = useRef(0);

  const resultsRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      resultsRef.current = node;
      if (node) {
        controller.current.attach(node);
      } else {
        controller.current.detach();
      }
    },
    [controller]
  );

  useLayoutEffect(() => {
    const el = resultsRef.current;
    if (!el) return;
    const newScrollHeight = el.scrollHeight;
    const heightDiff = newScrollHeight - prevScrollHeightRef.current;
    const turnsAdded = turns.length > prevTurnCountRef.current;

    if (turnsAdded && heightDiff > 0 && prevScrollHeightRef.current > 0) {
      controller.current.onNewMessages(heightDiff, false, false);
    } else if (prevScrollHeightRef.current === 0 && turns.length > 0) {
      controller.current.snapToBottom();
    }

    prevScrollHeightRef.current = newScrollHeight;
    prevTurnCountRef.current = turns.length;
  }, [turns.length, controller]);

  const AGENTIC_COMPOSER_MAX_HEIGHT_PX = 192;
  const AGENTIC_COMPOSER_MIN_HEIGHT_PX = 40;

  const adjustComposerHeight = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    beginResize();
    const measured = measureTextareaContentHeightPx(el, AGENTIC_COMPOSER_MAX_HEIGHT_PX);
    el.style.height = `${Math.max(measured, AGENTIC_COMPOSER_MIN_HEIGHT_PX)}px`;
    endResize();
  }, [beginResize, endResize]);

  useLayoutEffect(() => {
    adjustComposerHeight();
  }, [adjustComposerHeight]);

  useEffect(() => {
    adjustComposerHeight();
  }, [composerText, adjustComposerHeight]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => adjustComposerHeight());
    observer.observe(el);
    return () => observer.disconnect();
  }, [adjustComposerHeight]);

  // ── @ file reference autocomplete ──────────────────────────────────────
  const composerAnchorRef = useRef<HTMLDivElement>(null);

  const fileAutocomplete = useFileReferenceAutocomplete({
    files: autocompleteFiles,
    hasWorkspace: hasAutocompleteWorkspace,
    onAtTriggerActivate,
    dropdownPlacement: 'above',
    textareaRef: composerRef,
    anchorRef: composerAnchorRef,
    text: composerText,
    onTextChange: setComposerText,
    onAfterUpdate: adjustComposerHeight,
  });

  const handleComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (fileAutocomplete.handleAutocompleteKeyDown(e)) return;
      if (e.key !== 'Enter') return;
      if (isModEnterKey(e)) return;
      e.preventDefault();
      void handleCompose();
    },
    [fileAutocomplete, handleCompose]
  );

  const submitDisabled =
    !canCompose ||
    isSubmitting ||
    !composerText.trim() ||
    isLoading ||
    !harnessSelection.selectionReady;
  const submitLabel = isSubmitting
    ? isFollowUpMode
      ? 'Sending…'
      : 'Submitting…'
    : isFollowUpMode
      ? 'Follow up'
      : 'Search';

  if (isNotFound) {
    return (
      <div
        className="flex-1 flex items-center justify-center p-8 text-center"
        data-testid="agentic-query-unavailable"
      >
        <p className="text-sm text-chatroom-text-muted max-w-md">
          This search session is no longer available. It may have expired or been removed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="agentic-query-panel">
      <AgenticQueryHarnessSync
        queryId={queryId as Id<'chatroom_agenticQueries'>}
        queryStatus={query?.status}
        activeRunId={activeRunId}
      />

      <div className="relative flex-1 min-h-0">
        <div
          ref={resultsRefCallback}
          className="h-full overflow-y-auto p-4 space-y-4"
          data-testid="agentic-query-results"
        >
          {turns.map((turn, index) => (
            <AgenticTurnBlock
              key={turn._id}
              turn={turn}
              isLatest={index === turns.length - 1}
              isRunning={index === turns.length - 1 && isRunning}
              activeRunId={activeRunId}
            />
          ))}
        </div>

        {activeRunId ? (
          <AgenticQueryStreamScrollSync
            runId={activeRunId}
            controller={controller}
            feedRef={resultsRef}
          />
        ) : null}

        {!isPinned ? (
          <button
            type="button"
            onClick={scrollToBottom}
            style={{ bottom: JUMP_TO_NEW_MESSAGES_GAP_PX }}
            className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent shadow-lg hover:bg-chatroom-accent/90 transition-all"
            aria-label="Jump to new messages"
            data-testid="agentic-query-jump-to-new"
          >
            <ChevronDown size={16} />
            <span className="text-xs font-medium">Jump to new messages</span>
          </button>
        ) : null}
      </div>

      <div
        className="shrink-0 p-4 gap-4 flex flex-col border-t border-chatroom-border bg-chatroom-bg-primary"
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
          workspaceId={workspaceId}
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

        <div ref={composerAnchorRef} className="relative flex gap-2 items-end">
          <FileReferenceAutocomplete
            results={fileAutocomplete.autocompleteState.results}
            selectedIndex={fileAutocomplete.autocompleteState.selectedIndex}
            position={fileAutocomplete.autocompleteState.position}
            onSelect={fileAutocomplete.handleFileSelect}
            onHoverItem={fileAutocomplete.setSelectedIndex}
            visible={fileAutocomplete.autocompleteState.visible}
            placement="above"
          />
          <textarea
            ref={composerRef}
            rows={1}
            value={composerText}
            onChange={fileAutocomplete.handleTextareaChange}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              isFollowUpMode
                ? 'Ask a follow-up or refine the results…'
                : 'Search or ask about the codebase…'
            }
            className="min-h-[2.5rem] max-h-48 flex-1 min-w-0 resize-none overflow-hidden bg-chatroom-bg-tertiary border border-chatroom-border px-3 py-2 text-[13px] text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none focus:border-chatroom-accent font-mono leading-normal"
            data-testid="agentic-query-composer-input"
          />
          <button
            type="button"
            data-testid={isFollowUpMode ? 'agentic-query-follow-up' : 'agentic-query-submit'}
            disabled={submitDisabled}
            onClick={() => void handleCompose()}
            aria-label={submitLabel}
            className={cn(
              'md:hidden size-10 shrink-0 !h-10 !w-10 !px-0 rounded-sm disabled:cursor-not-allowed',
              isFollowUpMode
                ? chatroomIndustrialButtonSecondaryClassName
                : chatroomIndustrialButtonPrimaryClassName
            )}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isFollowUpMode ? (
              <Send className="size-4" />
            ) : (
              <Search className="size-4" />
            )}
          </button>
        </div>

        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>
    </div>
  );
}

function isDraftLike(status: string | undefined): boolean {
  return status === 'draft' || status === undefined;
}
