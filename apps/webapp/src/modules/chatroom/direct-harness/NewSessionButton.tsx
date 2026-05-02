'use client';

/**
 * NewSessionButton — opens an agent-picker popover, then calls openSession.
 *
 * Disabled with tooltip when no agents are available (harness not booted yet).
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Plus, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';


interface PublishedAgent {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string };
  description?: string;
}

interface NewSessionButtonProps {
  workspaceId: string;
  machineId: string | null;
  chatroomId: string;
  availableAgents: PublishedAgent[];
}

export function NewSessionButton({
  workspaceId,
  machineId,
  chatroomId: _chatroomId,
  availableAgents,
}: NewSessionButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const openSessionMutation = useSessionMutation(
    api.chatroom.directHarness.sessions.openSession
  );

  const harnessReady = machineId !== null && availableAgents.length > 0;
  const primaryAgents = availableAgents.filter(
    (a) => a.mode === 'primary' || a.mode === 'all'
  );

  const handleConfirm = async () => {
    if (!selectedAgent || !machineId) return;
    setIsOpening(true);
    try {
      await openSessionMutation({
        workspaceId: workspaceId as Id<'chatroom_workspaces'>,
        harnessName: 'opencode-sdk',
        agent: selectedAgent,
      });
      setOpen(false);
      setSelectedAgent(null);
    } catch (err) {
      console.error('Failed to open harness session:', err);
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
      onClick={() => harnessReady && setOpen(true)}
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
      <PopoverContent
        className="w-56 p-3 bg-card border-border text-foreground"
        align="start"
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">Choose agent</p>
          <div className="space-y-1">
            {primaryAgents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No primary agents available.</p>
            ) : (
              primaryAgents.map((agent) => (
                <button
                  key={agent.name}
                  onClick={() => setSelectedAgent(agent.name)}
                  className={`w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors hover:bg-accent/50 ${
                    selectedAgent === agent.name
                      ? 'bg-accent text-foreground'
                      : 'text-foreground'
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
