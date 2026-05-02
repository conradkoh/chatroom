'use client';

import { useState } from 'react';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Plus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublishedAgent {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string };
  description?: string;
}

interface NewSessionButtonProps {
  workspaceId: Id<'chatroom_workspaces'>;
  chatroomId: Id<'chatroom_rooms'>;
  onSessionCreated: (newSessionId: Id<'chatroom_harnessSessions'>) => void;
}

// ─── NewSessionButton ─────────────────────────────────────────────────────────

export function NewSessionButton({
  workspaceId,
  chatroomId,
  onSessionCreated,
}: NewSessionButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registry = useSessionQuery(api.chatroom.directHarness.capabilities.getMachineRegistry, {
    chatroomId,
  });
  const openSession = useSessionMutation(api.chatroom.directHarness.sessions.openSession);

  // Dedupe agents for this workspace: flatMap machines → filter workspace → flatMap harnesses → flatMap agents
  // Multiple machines may publish overlapping agent names — pick first occurrence
  const allAgents: PublishedAgent[] = registry
    ? (() => {
        const seen = new Set<string>();
        const agents: PublishedAgent[] = [];
        for (const machine of registry) {
          for (const ws of machine.workspaces) {
            if (ws.workspaceId !== workspaceId) continue;
            for (const harness of (ws as any).harnesses ?? (ws as any).agents ?? []) {
              const agentList: PublishedAgent[] = Array.isArray(harness.agents)
                ? harness.agents
                : [harness]; // backward compat if old shape
              for (const agent of agentList) {
                if (!seen.has(agent.name)) {
                  seen.add(agent.name);
                  agents.push(agent as PublishedAgent);
                }
              }
            }
          }
        }
        return agents;
      })()
    : [];

  const availableAgents = allAgents.filter((a) => a.mode === 'primary' || a.mode === 'all');

  const harnessReady = registry !== undefined && availableAgents.length > 0;

  const handleConfirm = async () => {
    if (!selectedAgent) return;
    setIsOpening(true);
    setError(null);
    try {
      const result = await openSession({
        workspaceId,
        harnessName: 'opencode-sdk',
        config: { agent: selectedAgent },
        firstPrompt: { parts: [{ type: 'text', text: `Starting session as ${selectedAgent}` }] },
      });
      onSessionCreated(result.harnessSessionRowId);
      setOpen(false);
      setSelectedAgent(null);
    } catch (err) {
      console.error('Failed to open harness session:', err);
      setError(err instanceof Error ? err.message : 'Failed to open session.');
    } finally {
      setIsOpening(false);
    }
  };

  const trigger = (
    <Button
      size="sm"
      variant="outline"
      className="w-full h-7 text-xs gap-1.5 border-border text-foreground hover:bg-accent/50 disabled:opacity-50"
      disabled={!harnessReady}
    >
      <Plus size={12} />
      New session
    </Button>
  );

  if (!harnessReady) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent className="bg-card border-border text-foreground text-xs">
            Workspace harness is starting…
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-3 bg-card border-border text-foreground" align="start">
        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">Choose agent</p>
          <div className="space-y-1">
            {availableAgents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No primary agents available.</p>
            ) : (
              availableAgents.map((agent) => (
                <button
                  key={agent.name}
                  onClick={() => setSelectedAgent(agent.name)}
                  className={`w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors hover:bg-accent/50 ${
                    selectedAgent === agent.name ? 'bg-accent text-foreground' : 'text-foreground'
                  }`}
                >
                  <div className="font-medium">{agent.name}</div>
                  {agent.description && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {agent.description}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            disabled={!selectedAgent || isOpening}
            onClick={handleConfirm}
          >
            {isOpening ? (
              <>
                <Loader2 size={12} className="animate-spin mr-1" />
                Opening…
              </>
            ) : (
              'Open session'
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
