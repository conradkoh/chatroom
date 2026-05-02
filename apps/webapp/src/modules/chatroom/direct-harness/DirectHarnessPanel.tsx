'use client';

/**
 * DirectHarnessPanel — workspace picker, session list, message stream, and composer.
 *
 * Rendered inside the chatroom sidebar when featureFlags.directHarnessWorkers is true.
 * Fully gated at the component boundary — returns null when the flag is off.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { ChevronDown, Terminal } from 'lucide-react';
import { useState, useCallback } from 'react';

import { NewSessionButton } from './NewSessionButton';
import { SessionList } from './SessionList';
import { WorkspacePicker } from './WorkspacePicker';
import { SessionMessageStream } from './SessionMessageStream';
import { SessionComposer } from './SessionComposer';
import { HarnessBootIndicator } from './HarnessBootIndicator';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DirectHarnessPanelProps {
  chatroomId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DirectHarnessPanel({ chatroomId }: DirectHarnessPanelProps) {
  // Gate on feature flag — synchronous import, no Convex query needed
  if (!featureFlags.directHarnessWorkers) return null;

  return <DirectHarnessPanelInner chatroomId={chatroomId} />;
}

function DirectHarnessPanelInner({ chatroomId }: DirectHarnessPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Machine registry — used to determine available agents per workspace
  const machineRegistries = useSessionQuery(
    api.chatroom.directHarness.capabilities.getMachineRegistry,
    { chatroomId: chatroomId as Id<'chatroom_rooms'> }
  );

  // Currently selected session (for status gating)
  const selectedSession = useSessionQuery(
    api.chatroom.directHarness.sessions.getSession,
    selectedSessionId
      ? { harnessSessionRowId: selectedSessionId as Id<'chatroom_harnessSessions'> }
      : 'skip'
  );

  // Find machine + agents for the selected workspace
  const selectedWorkspaceMachineId = (() => {
    if (!selectedWorkspaceId || !machineRegistries) return null;
    for (const reg of machineRegistries) {
      const wsEntry = reg.workspaces.find((w) => w.workspaceId === selectedWorkspaceId);
      if (wsEntry) return reg.machineId;
    }
    return null;
  })();

  const availableAgents = (() => {
    if (!selectedWorkspaceId || !machineRegistries) return [];
    for (const reg of machineRegistries) {
      const wsEntry = reg.workspaces.find((w) => w.workspaceId === selectedWorkspaceId);
      if (wsEntry) return wsEntry.agents;
    }
    return [];
  })();

  const isBooting =
    selectedSession?.status === 'pending' || selectedSession?.status === 'spawning';

  const handleRequestNewSession = useCallback(() => {
    setSelectedSessionId(null); // deselect session to show new-session button
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      {/* Panel header */}
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-accent/50 transition-colors border-t border-border">
        <div className="flex items-center gap-1.5">
          <Terminal size={12} />
          <span>Direct Harness</span>
        </div>
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-2 space-y-3">
          {/* Workspace picker */}
          <WorkspacePicker
            chatroomId={chatroomId}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelect={(id) => {
              setSelectedWorkspaceId(id);
              setSelectedSessionId(null); // reset session when workspace changes
            }}
          />

          {/* Session list + new session button */}
          {selectedWorkspaceId && (
            <>
              <SessionList
                workspaceId={selectedWorkspaceId}
                selectedSessionId={selectedSessionId}
                onSelect={setSelectedSessionId}
              />
              {!selectedSessionId && (
                <NewSessionButton
                  workspaceId={selectedWorkspaceId}
                  machineId={selectedWorkspaceMachineId}
                  chatroomId={chatroomId}
                  availableAgents={availableAgents}
                />
              )}
            </>
          )}

          {/* Session view — shown when a session is selected */}
          {selectedSessionId && selectedWorkspaceId && (
            <div className="space-y-2 border-t border-border pt-2">
              {/* Boot indicator — shown during pending/spawning */}
              {isBooting && <HarnessBootIndicator />}

              {/* Message stream */}
              {!isBooting && (
                <SessionMessageStream sessionId={selectedSessionId} />
              )}

              {/* Composer */}
              <SessionComposer
                sessionId={selectedSessionId}
                chatroomId={chatroomId}
                workspaceId={selectedWorkspaceId}
                availableAgents={availableAgents}
                onRequestNewSession={handleRequestNewSession}
              />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
