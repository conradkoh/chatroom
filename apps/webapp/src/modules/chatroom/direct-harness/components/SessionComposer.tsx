'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { Send } from 'lucide-react';
import { useRef, useState } from 'react';

import { HarnessSelectorBar, parseModelKey } from './harness-selectors';
import type { SessionStatus } from './StatusDot';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { useCreateSession } from '../hooks/useCreateSession';
import { useHarnessConfig } from '../hooks/useHarnessConfig';
import { useHarnessModelFilter } from '../hooks/useHarnessModelFilter';
import { useSendMessage } from '../hooks/useSendMessage';

function ComposerSendRow({
  textareaRef,
  text,
  onTextChange,
  onKeyDown,
  onSend,
  canSend,
  disabled,
  autoFocus,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  onTextChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  canSend: boolean;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex gap-2 items-end">
      <Textarea
        ref={textareaRef}
        rows={3}
        className="flex-1 resize-none text-sm"
        placeholder="Message… (Enter to send, Shift+Enter for new line)"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <Button
        size="icon"
        className="shrink-0 h-9 w-9"
        aria-label="Send message"
        disabled={!canSend}
        onClick={() => void onSend()}
      >
        <Send size={15} />
      </Button>
    </div>
  );
}

function useEnterToSendKeyDown(onSend: () => void) {
  return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  };
}

function useWorkspaceHarnessConfig(
  workspaceId: Id<'chatroom_workspaces'>,
  harnessName: string,
  initial?: { agent?: string; model?: { providerID: string; modelID: string } }
) {
  const capabilities = useSessionQuery(
    api.web.directHarness.capabilities.listForWorkspace,
    workspaceId ? { workspaceId } : 'skip'
  );

  const harnesses = capabilities?.harnesses ?? [];
  const machineId = capabilities?.machineId ?? null;
  const filter = useHarnessModelFilter(machineId, harnessName);
  const config = useHarnessConfig({
    harnesses,
    harnessName,
    initial,
    isModelHidden: filter.isHidden,
  });

  return { harnesses, machineId, filter, config };
}

// ─── NewSessionComposer ───────────────────────────────────────────────────────

/**
 * Shown in the right pane when no session is selected.
 * Typing and sending creates a new session with the message as the first prompt.
 */
export function NewSessionComposer({
  workspaceId,
  onSessionCreated,
}: {
  workspaceId: Id<'chatroom_workspaces'>;
  onSessionCreated: (id: Id<'chatroom_harnessSessions'>) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [harnessName, setHarnessName] = useState('opencode-sdk');
  const { create, isCreating } = useCreateSession();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { harnesses, filter, config } = useWorkspaceHarnessConfig(workspaceId, harnessName);

  const { resolvedAgent, resolvedModel } = config;

  const trimmed = text.trim();
  const canSend = !!trimmed && !isCreating && !!resolvedModel;

  const handleSend = async () => {
    if (!canSend) return;
    setError(null);
    const model = parseModelKey(resolvedModel);
    try {
      const result = await create({
        workspaceId,
        harnessName,
        config: {
          agent: resolvedAgent,
          ...(model ? { model } : {}),
        },
        firstMessage: trimmed,
      });
      onSessionCreated(result.harnessSessionId);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session.');
    }
  };

  const handleKeyDown = useEnterToSendKeyDown(handleSend);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Empty state */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
        <p className="text-xs font-bold uppercase tracking-wider text-foreground">New session</p>
        <p className="text-xs">Type a message below to get started.</p>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t-2 border-border p-3 flex flex-col gap-2">
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {/* Textarea + send button */}
        <ComposerSendRow
          textareaRef={textareaRef}
          text={text}
          onTextChange={setText}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
          canSend={canSend}
          disabled={isCreating}
          autoFocus
        />

        {/* Harness + agent + model selectors + filter button */}
        <HarnessSelectorBar
          harnesses={harnesses}
          harnessName={harnessName}
          onHarnessChange={setHarnessName}
          config={config}
          filter={filter}
        />
      </div>
    </div>
  );
}

// ─── SessionComposer ──────────────────────────────────────────────────────────

/**
 * Shown at the bottom of an active session for follow-up messages.
 *
 * Exposes the harness/agent/model bar in frozen-harness mode so the user can
 * see (and in future, switch) the agent and model for the current session.
 * The harness dropdown is rendered but disabled since it can't change mid-session.
 */
export function SessionComposer({
  sessionRowId,
  status,
  workspaceId,
  harnessName,
  lastUsedConfig,
}: {
  sessionRowId: Id<'chatroom_harnessSessions'>;
  status: SessionStatus;
  workspaceId: Id<'chatroom_workspaces'>;
  harnessName: string;
  lastUsedConfig?: { agent?: string; model?: { providerID: string; modelID: string } };
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { send, isSending } = useSendMessage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { harnesses, filter, config } = useWorkspaceHarnessConfig(
    workspaceId,
    harnessName,
    lastUsedConfig
  );

  const isTerminal = status === 'closed' || status === 'failed';
  const isDisabled = status === 'pending' || status === 'spawning' || isTerminal || isSending;

  const terminalMessage =
    status === 'failed'
      ? 'Session data was not found and cannot be recovered. Start a new session to continue.'
      : 'This session has been closed.';
  const trimmed = text.trim();
  const canSend = !!trimmed && !isDisabled;

  const handleSend = async () => {
    if (!canSend) return;
    setError(null);
    try {
      // TODO: when in-session agent/model switching ships, pass resolvedAgent +
      // resolvedModel to send() here so they override the session's config.
      await send({ harnessSessionId: sessionRowId, text: trimmed });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send.');
    }
  };

  const handleKeyDown = useEnterToSendKeyDown(handleSend);

  if (isTerminal) {
    return (
      <div className="shrink-0 border-t-2 border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">{terminalMessage}</p>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t-2 border-border p-3 flex flex-col gap-2">
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <ComposerSendRow
        textareaRef={textareaRef}
        text={text}
        onTextChange={setText}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        canSend={canSend}
        disabled={isDisabled}
      />
      {/* Harness/agent/model bar — harness frozen mid-session; filter button visible when machineId is known */}
      {/* TODO: when in-session agent/model switching ships, pass resolvedAgent + resolvedModel to send(). */}
      <HarnessSelectorBar
        harnesses={harnesses}
        harnessName={harnessName}
        onHarnessChange={() => {}} // no-op: harness frozen mid-session
        harnessFrozen
        config={config}
        filter={filter}
      />
    </div>
  );
}
