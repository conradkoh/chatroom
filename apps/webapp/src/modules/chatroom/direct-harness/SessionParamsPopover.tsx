'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { ChevronDown, ChevronUp, RefreshCw, Settings2 } from 'lucide-react';
import { useState } from 'react';

import {
  buildModelKey,
  HarnessAgentSelect,
  HarnessModelSelect,
  parseModelKey,
} from './components/HarnessSelects';
import { useHarnessConfig } from './hooks/useHarnessConfig';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

import { useRefreshCapabilities } from './hooks/useRefreshCapabilities';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionParamsPopoverProps {
  harnessSessionRowId: Id<'chatroom_harnessSessions'>;
  workspaceId: Id<'chatroom_workspaces'>;
  harnessName: string;
  lastUsedConfig: {
    agent: string;
    model?: { providerID: string; modelID: string };
    system?: string;
    tools?: Record<string, boolean>;
  };
}

// ─── SessionParamsPopover ─────────────────────────────────────────────────────

export function SessionParamsPopover({
  harnessSessionRowId,
  workspaceId,
  harnessName,
  lastUsedConfig,
}: SessionParamsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  // v1: tools as free-form JSON textarea.
  // TODO: Replace with a structured per-tool toggle list once opencode exposes
  // a stable known-tools endpoint (structured editor is future work).
  const [toolsJson, setToolsJson] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh, isRefreshing } = useRefreshCapabilities();

  const harnesses = useSessionQuery(api.chatroom.directHarness.capabilities.listForWorkspace, {
    workspaceId,
  });

  const updateSessionConfig = useSessionMutation(
    api.chatroom.directHarness.sessions.updateSessionConfig
  );

  const {
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    eligibleAgents,
    providers,
    resolvedAgent,
  } = useHarnessConfig({
    harnesses,
    harnessName,
    initial: { agent: lastUsedConfig.agent, model: lastUsedConfig.model },
  });

  // Hydrate form when popover opens
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setSelectedAgent(lastUsedConfig.agent);
      setSelectedModel(buildModelKey(lastUsedConfig.model));
      setSystemPrompt(lastUsedConfig.system ?? '');
      setToolsJson(lastUsedConfig.tools ? JSON.stringify(lastUsedConfig.tools, null, 2) : '');
      setError(null);
      setShowAdvanced(false);
    }
  };

  const canApply = !!resolvedAgent && !isApplying;

  const handleApply = async () => {
    if (!canApply) return;
    setIsApplying(true);
    setError(null);
    try {
      let tools: Record<string, boolean> | undefined;
      if (toolsJson.trim()) {
        try {
          tools = JSON.parse(toolsJson) as Record<string, boolean>;
        } catch {
          setError('Tools JSON is invalid. Fix or clear it before applying.');
          return;
        }
      }

      const model = parseModelKey(selectedModel);

      await updateSessionConfig({
        harnessSessionRowId,
        config: {
          agent: resolvedAgent,
          ...(model ? { model } : {}),
          ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
          ...(tools ? { tools } : {}),
        },
      });

      setOpen(false);
    } catch (err) {
      console.error('Failed to update session config:', err);
      setError(err instanceof Error ? err.message : 'Failed to update config.');
    } finally {
      setIsApplying(false);
    }
  };

  // Build trigger label
  const triggerLabel = (() => {
    const agent = lastUsedConfig.agent;
    const model = lastUsedConfig.model;
    if (model) return `${agent} · ${model.modelID}`;
    return agent;
  })();

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 gap-1"
        >
          <Settings2 size={11} />
          {triggerLabel}
          <ChevronDown size={10} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 bg-card border-border text-foreground space-y-3"
        align="start"
      >
        {/* Header row with refresh button */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Session settings</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent/50"
            onClick={() => refresh(workspaceId)}
            disabled={isRefreshing}
            title="Refresh capabilities"
          >
            <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
          </Button>
        </div>

        {/* Agent */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
          <HarnessAgentSelect
            agents={eligibleAgents}
            value={resolvedAgent}
            onValueChange={(v) => {
              setSelectedAgent(v);
              setSelectedModel('');
            }}
          />
        </div>

        {/* Model */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            Model <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <HarnessModelSelect
            providers={providers}
            value={selectedModel}
            onValueChange={setSelectedModel}
          />
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Advanced
        </button>

        {showAdvanced && (
          <div className="space-y-3">
            {/* System prompt */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">System prompt</Label>
              <Textarea
                rows={3}
                className="resize-none text-xs bg-background border-border"
                placeholder="Override system prompt…"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>

            {/* Tools — free-form JSON for v1 */}
            {/* TODO: Replace with a structured per-tool toggle list once opencode
                      exposes a stable known-tools endpoint. */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Tools <span className="text-muted-foreground/60">(JSON, optional)</span>
              </Label>
              <Textarea
                rows={3}
                className="resize-none text-xs bg-background border-border font-mono"
                placeholder={'{ "bash": true, "web": false }'}
                value={toolsJson}
                onChange={(e) => setToolsJson(e.target.value)}
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {!resolvedAgent && (
          <p className="text-xs text-muted-foreground">Select an agent to apply changes.</p>
        )}

        <Button
          size="sm"
          className="w-full"
          disabled={!canApply}
          onClick={() => void handleApply()}
        >
          {isApplying ? 'Applying…' : 'Apply'}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
