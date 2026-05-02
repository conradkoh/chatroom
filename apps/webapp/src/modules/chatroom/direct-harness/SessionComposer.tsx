'use client';

/**
 * SessionComposer — textarea, send button, and agent chip.
 *
 * Agent chip shows the current session.agent. Clicking opens a popover
 * of available agents (from machine registry). Selecting calls updateSessionAgent
 * optimistically and reverts + toasts on rejection.
 *
 * Status gating:
 *   pending/spawning → disabled (boot indicator shown separately)
 *   active/idle      → enabled
 *   closed/failed    → disabled with banner + "open new session" CTA
 */

import { useState, useCallback, useRef } from 'react';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { api } from '@workspace/backend/convex/_generated/api';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, Send, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublishedAgent {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  description?: string;
}

type SessionStatus = 'pending' | 'spawning' | 'active' | 'idle' | 'closed' | 'failed';

interface SessionComposerProps {
  sessionId: string;
  chatroomId: string;
  workspaceId: string;
  availableAgents: PublishedAgent[];
  /** Called when user clicks "open new session" from the closed/failed banner. */
  onRequestNewSession?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionComposer({
  sessionId,
  chatroomId: _chatroomId,
  workspaceId: _workspaceId,
  availableAgents,
  onRequestNewSession,
}: SessionComposerProps) {
  const session = useSessionQuery(api.chatroom.directHarness.sessions.getSession, {
    harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
  });

  const submitPromptMutation = useSessionMutation(api.chatroom.directHarness.prompts.submitPrompt);
  const updateSessionAgentMutation = useSessionMutation(
    api.chatroom.directHarness.sessions.updateSessionAgent
  );

  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  // Local optimistic agent value
  const [optimisticAgent, setOptimisticAgent] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const status = session?.status as SessionStatus | undefined;
  const currentAgent = optimisticAgent ?? session?.agent ?? '';
  const isDisabled = !status || status === 'pending' || status === 'spawning' || status === 'closed' || status === 'failed';
  const isClosedOrFailed = status === 'closed' || status === 'failed';

  const primaryAgents = availableAgents.filter((a) => a.mode === 'primary' || a.mode === 'all');

  const handleSend = useCallback(async () => {
    if (!text.trim() || isDisabled || isSending) return;
    const content = text.trim();
    setText('');
    setIsSending(true);
    try {
      await submitPromptMutation({
        harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
        parts: [{ type: 'text', text: content }],
      });
    } catch (err) {
      toast.error('Failed to send prompt', {
        description: err instanceof Error ? err.message : String(err),
      });
      // Restore text on failure
      setText(content);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [text, isDisabled, isSending, submitPromptMutation, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleAgentSelect = useCallback(
    async (agentName: string) => {
      const previousAgent = optimisticAgent ?? session?.agent ?? null;
      setOptimisticAgent(agentName);
      setAgentPopoverOpen(false);
      try {
        await updateSessionAgentMutation({
          harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
          agent: agentName,
        });
      } catch (err) {
        // Revert optimistic update
        setOptimisticAgent(previousAgent);
        toast.error('Failed to switch agent', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [optimisticAgent, session?.agent, updateSessionAgentMutation, sessionId]
  );

  // Closed/failed banner
  if (isClosedOrFailed) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-2 py-2 bg-red-500/10 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded-sm border border-red-500/30 text-xs">
          <XCircle size={12} className="shrink-0" />
          <span>
            Session {status}.{' '}
            {onRequestNewSession ? (
              <button
                className="underline cursor-pointer hover:opacity-80"
                onClick={onRequestNewSession}
              >
                Open new session
              </button>
            ) : null}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Agent chip */}
      {session && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Agent:</span>
          {primaryAgents.length > 0 ? (
            <Popover open={agentPopoverOpen} onOpenChange={setAgentPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted hover:bg-accent/50 text-foreground cursor-pointer transition-colors border border-border"
                  disabled={isDisabled}
                >
                  {currentAgent}
                  <ChevronDown size={10} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2 bg-card border-border" align="start">
                <div className="space-y-1">
                  {primaryAgents.map((agent) => (
                    <button
                      key={agent.name}
                      onClick={() => void handleAgentSelect(agent.name)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors hover:bg-accent/50',
                        currentAgent === agent.name
                          ? 'bg-accent text-foreground'
                          : 'text-foreground'
                      )}
                    >
                      <div className="font-medium">{agent.name}</div>
                      {agent.description && (
                        <div className="text-[10px] text-muted-foreground">{agent.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-foreground border border-border">
              {currentAgent}
            </span>
          )}
        </div>
      )}

      {/* Textarea + send button */}
      <div className="relative">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isDisabled}
                placeholder={
                  isDisabled ? 'Harness is starting…' : 'Type a prompt… (Enter to send)'
                }
                rows={2}
                className={cn(
                  'w-full resize-none text-xs px-2 py-1.5 pr-8 rounded-sm border border-border',
                  'bg-card text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-1 focus:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              />
            </TooltipTrigger>
            {isDisabled && !isClosedOrFailed && (
              <TooltipContent className="bg-card border-border text-foreground text-xs">
                Harness is starting…
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <Button
          size="sm"
          variant="ghost"
          disabled={isDisabled || !text.trim() || isSending}
          onClick={() => void handleSend()}
          className="absolute right-1 bottom-1 h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        >
          <Send size={12} />
        </Button>
      </div>
    </div>
  );
}
