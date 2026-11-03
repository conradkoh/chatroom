'use client';

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { nextConversationMode } from '@workspace/shared/domain/conversation-mode';
import { Code2, MessageCircle, RotateCcw, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Presentational session-policy and conversation-mode buttons shared by the
 * scheduled-prompt sidebar row. Stateless: the caller owns the mutation and
 * passes the pending flag, so no optimistic policy state exists here.
 */

const MODE_LABEL: Record<ConversationMode, string> = {
  chat: 'Chat',
  code: 'Code',
  'code:enhanced': 'Enhance',
};

function ModeIcon({ mode }: { mode: ConversationMode }) {
  if (mode === 'chat') return <MessageCircle size={14} aria-hidden />;
  if (mode === 'code') return <Code2 size={14} aria-hidden />;
  return <Sparkles size={14} aria-hidden />;
}

const BUTTON_BASE_CLASS =
  'p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50';

export interface SessionPolicyButtonProps {
  isNewSession: boolean;
  pending: boolean;
  onToggle: () => void;
  testId: string;
}

export function SessionPolicyButton({
  isNewSession,
  pending,
  onToggle,
  testId,
}: SessionPolicyButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={isNewSession}
      aria-label="Start in new session"
      aria-busy={pending || undefined}
      disabled={pending}
      title={
        isNewSession
          ? 'New session enabled — click to disable.'
          : 'New session disabled — click to enable.'
      }
      onClick={onToggle}
      className={cn(
        BUTTON_BASE_CLASS,
        isNewSession
          ? 'text-yellow-500 dark:text-yellow-400'
          : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
      )}
    >
      <RotateCcw size={14} aria-hidden />
    </button>
  );
}

export interface ConversationModeButtonProps {
  mode: ConversationMode;
  pending: boolean;
  onCycle: () => void;
  testId: string;
}

export function ConversationModeButton({
  mode,
  pending,
  onCycle,
  testId,
}: ConversationModeButtonProps) {
  const label = MODE_LABEL[mode];
  const nextLabel = MODE_LABEL[nextConversationMode(mode)];
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`Mode: ${label}`}
      aria-busy={pending || undefined}
      disabled={pending}
      title={`Mode: ${label} — click to switch to ${nextLabel}.`}
      onClick={onCycle}
      className={cn(
        BUTTON_BASE_CLASS,
        mode === 'code:enhanced'
          ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
          : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
      )}
    >
      <ModeIcon mode={mode} />
    </button>
  );
}
