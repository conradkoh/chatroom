'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useHarnessConfig, type HarnessOption } from './hooks/useHarnessConfig';
import { useRefreshCapabilities } from './hooks/useRefreshCapabilities';
import { CapabilitiesRefreshButton } from './components/CapabilitiesRefreshButton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewSessionFormProps {
  workspaceId: Id<'chatroom_workspaces'>;
  onSessionCreated: (newSessionId: Id<'chatroom_harnessSessions'>) => void;
}

const FALLBACK_HARNESS: HarnessOption = {
  name: 'opencode-sdk',
  displayName: 'Opencode',
  agents: [],
  providers: [],
};

// ─── NewSessionForm ───────────────────────────────────────────────────────────

export function NewSessionForm({ workspaceId, onSessionCreated }: NewSessionFormProps) {
  const [open, setOpen] = useState(false);
  const [selectedHarness, setSelectedHarness] = useState<string>('');
  const [firstMessage, setFirstMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLoadingBanner, setShowLoadingBanner] = useState(false);

  const harnesses = useSessionQuery(api.chatroom.directHarness.capabilities.listForWorkspace, {
    workspaceId,
  });
  const openSession = useSessionMutation(api.chatroom.directHarness.sessions.openSession);

  const { refresh } = useRefreshCapabilities();

  // Show loading banner 500ms after open if harnesses still empty
  useEffect(() => {
    if (!open) {
      setShowLoadingBanner(false);
      return;
    }
    if (harnesses && harnesses.length > 0) {
      setShowLoadingBanner(false);
      return;
    }
    const timer = setTimeout(() => setShowLoadingBanner(true), 500);
    return () => clearTimeout(timer);
  }, [open, harnesses]);

  // Build harness options (fallback when empty/undefined)
  const harnessOptions: HarnessOption[] = useMemo(
    () => (harnesses && harnesses.length > 0 ? harnesses : [FALLBACK_HARNESS]),
    [harnesses]
  );

  // Resolved harness: user selection if valid, else first option
  const currentHarness: HarnessOption =
    harnessOptions.find((h) => h.name === selectedHarness) ?? harnessOptions[0];

  const {
    setSelectedAgent,
    setSelectedModel,
    eligibleAgents,
    resolvedAgent,
    resolvedModel,
    modelOptions,
  } = useHarnessConfig({ harnesses: harnessOptions, harnessName: currentHarness?.name ?? '' });

  const handleRefresh = useCallback(() => {
    refresh(workspaceId);
  }, [refresh, workspaceId]);

  const resetForm = () => {
    setSelectedHarness('');
    setSelectedAgent('');
    setSelectedModel('');
    setFirstMessage('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // Auto-fire refresh on open
      handleRefresh();
    } else {
      resetForm();
    }
  };

  const trimmedMessage = firstMessage.trim();
  const canSubmit = !isSubmitting && !!resolvedAgent && !!trimmedMessage && !!currentHarness;

  const handleSubmit = async () => {
    if (!canSubmit || !currentHarness) return;
    setIsSubmitting(true);
    setError(null);
    try {
      let model: { providerID: string; modelID: string } | undefined;
      if (resolvedModel) {
        const [providerID, modelID] = resolvedModel.split('::');
        if (providerID && modelID) model = { providerID, modelID };
      }

      const result = await openSession({
        workspaceId,
        harnessName: currentHarness.name,
        config: {
          agent: resolvedAgent,
          ...(model ? { model } : {}),
        },
        firstPrompt: { parts: [{ type: 'text', text: trimmedMessage }] },
      });

      onSessionCreated(result.harnessSessionRowId);
      handleOpenChange(false);
    } catch (err) {
      console.error('Failed to open harness session:', err);
      setError(err instanceof Error ? err.message : 'Failed to open session.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs gap-1.5 border-border text-foreground hover:bg-accent/50"
        >
          <Plus size={12} />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="text-sm font-semibold">New session</DialogTitle>
            <CapabilitiesRefreshButton workspaceId={workspaceId} />
          </div>
        </DialogHeader>

        {showLoadingBanner && (!harnesses || harnesses.length === 0) && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Capabilities still loading — defaults shown. Click Refresh to retry.
          </div>
        )}

        <div className="space-y-4">
          {/* Harness */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Harness</label>
            <Select
              value={currentHarness?.name ?? ''}
              onValueChange={(v) => {
                setSelectedHarness(v);
                setSelectedAgent('');
                setSelectedModel('');
              }}
            >
              <SelectTrigger className="h-8 text-xs bg-background border-border">
                <SelectValue placeholder="Select harness" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                {harnessOptions.map((h) => (
                  <SelectItem key={h.name} value={h.name} className="text-xs">
                    {h.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Agent */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            {eligibleAgents.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">
                No agents available for this harness.
              </div>
            ) : (
              <Select
                value={resolvedAgent}
                onValueChange={(v) => {
                  setSelectedAgent(v);
                  setSelectedModel('');
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  {eligibleAgents.map((a) => (
                    <SelectItem key={a.name} value={a.name} className="text-xs">
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Model <span className="text-muted-foreground/60">(optional)</span>
            </label>
            {modelOptions.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">No models available.</div>
            ) : (
              <Select value={resolvedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue placeholder="Use agent default" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  {modelOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* First message */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">First message</label>
            <Textarea
              rows={3}
              className="resize-none text-xs bg-background border-border"
              placeholder="What would you like to do?"
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          {!resolvedAgent && eligibleAgents.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Select a harness with available agents to start a session.
            </p>
          )}

          <Button
            size="sm"
            className="w-full"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={12} className="animate-spin mr-1.5" />
                Creating…
              </>
            ) : (
              'Create & send'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
