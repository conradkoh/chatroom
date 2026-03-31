'use client';

/**
 * IntegrationsTab — Integrations settings for connecting external chat platforms.
 *
 * Shows a list of configured integrations and a setup wizard for adding new ones.
 * Currently supports Telegram with more platforms coming soon.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useSessionAction } from 'convex-helpers/react/sessions';
import {
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageSquare,
  Plus,
  Power,
  PowerOff,
  Trash2,
  X,
} from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

// ─── Types ──────────────────────────────────────────────────────────────

interface IntegrationsTabProps {
  chatroomId: string;
}

interface BotInfo {
  botId: number;
  botName: string;
  botUsername: string | null;
}

type WizardStep = 'select-platform' | 'enter-token' | 'confirm' | 'done';

// ─── Main Component ─────────────────────────────────────────────────────

export const IntegrationsTab = memo(function IntegrationsTab({
  chatroomId,
}: IntegrationsTabProps) {
  const integrations = useSessionQuery(api.integrations.list, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const [showWizard, setShowWizard] = useState(false);

  const hasIntegrations = integrations && integrations.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-chatroom-text-muted">
            Connect external chat platforms to this chatroom.
          </p>
        </div>
        {hasIntegrations && !showWizard && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowWizard(true)}
            className="text-xs gap-1.5"
          >
            <Plus size={14} />
            Add Integration
          </Button>
        )}
      </div>

      {/* Wizard */}
      {showWizard && (
        <TelegramSetupWizard
          chatroomId={chatroomId}
          onComplete={() => setShowWizard(false)}
          onCancel={() => setShowWizard(false)}
        />
      )}

      {/* Integration List */}
      {hasIntegrations && (
        <div className="space-y-3">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration._id}
              integration={integration}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!hasIntegrations && !showWizard && (
        <EmptyState onAdd={() => setShowWizard(true)} />
      )}
    </div>
  );
});

// ─── Empty State ────────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-lg bg-chatroom-bg-tertiary flex items-center justify-center mb-4">
        <MessageSquare size={24} className="text-chatroom-text-muted" />
      </div>
      <h3 className="text-sm font-bold text-chatroom-text-primary mb-1">
        No integrations configured
      </h3>
      <p className="text-xs text-chatroom-text-muted mb-6 max-w-xs">
        Connect Telegram or other platforms to receive and send messages directly in this chatroom.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="text-xs gap-1.5"
      >
        <Plus size={14} />
        Add Integration
      </Button>
    </div>
  );
});

// ─── Integration Card ───────────────────────────────────────────────────

const IntegrationCard = memo(function IntegrationCard({
  integration,
}: {
  integration: any;
}) {
  const updateIntegration = useSessionMutation(api.integrations.update);
  const removeIntegration = useSessionMutation(api.integrations.remove);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleToggle = useCallback(async () => {
    setIsToggling(true);
    try {
      await updateIntegration({
        integrationId: integration._id,
        enabled: !integration.enabled,
      });
    } finally {
      setIsToggling(false);
    }
  }, [integration._id, integration.enabled, updateIntegration]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await removeIntegration({ integrationId: integration._id });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [integration._id, removeIntegration]);

  const platformIcon = integration.platform === 'telegram' ? '✈️' : '💬';
  const platformName = integration.platform === 'telegram' ? 'Telegram' : integration.platform;

  return (
    <div className="border border-chatroom-border rounded-lg p-4 bg-chatroom-bg-secondary">
      <div className="flex items-center justify-between">
        {/* Left: Platform info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-chatroom-bg-tertiary flex items-center justify-center shrink-0 text-lg">
            {platformIcon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-chatroom-text-primary">
                {platformName}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  integration.enabled
                    ? 'bg-green-500/10 text-green-500 dark:bg-green-500/20 dark:text-green-400'
                    : 'bg-chatroom-bg-tertiary text-chatroom-text-muted'
                }`}
              >
                {integration.enabled ? (
                  <>
                    <Power size={10} />
                    Active
                  </>
                ) : (
                  <>
                    <PowerOff size={10} />
                    Disabled
                  </>
                )}
              </span>
            </div>
            {integration.config?.chatId && (
              <span className="text-[11px] text-chatroom-text-muted font-mono">
                Chat ID: {integration.config.chatId}
              </span>
            )}
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <Switch
            checked={integration.enabled}
            onCheckedChange={handleToggle}
            disabled={isToggling}
          />
          {showDeleteConfirm ? (
            <div className="flex items-center gap-1">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-xs h-7 px-2"
              >
                {isDeleting ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                className="text-xs h-7 px-2"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400 h-7 w-7 p-0"
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── Telegram Setup Wizard ──────────────────────────────────────────────

const TelegramSetupWizard = memo(function TelegramSetupWizard({
  chatroomId,
  onComplete,
  onCancel,
}: {
  chatroomId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<WizardStep>('enter-token');
  const [botToken, setBotToken] = useState('');
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const validateBotToken = useSessionAction(api.telegramActions.validateBotToken);
  const registerWebhook = useSessionAction(api.telegramActions.registerWebhook);
  const createIntegration = useSessionMutation(api.integrations.create);

  // Step 1: Validate the bot token
  const handleValidate = useCallback(async () => {
    if (!botToken.trim()) {
      setError('Please enter a bot token');
      return;
    }

    setError(null);
    setIsValidating(true);

    try {
      const info = await validateBotToken({ botToken: botToken.trim() });
      setBotInfo(info);
      setStep('confirm');
    } catch (err: any) {
      setError(
        err?.data?.message ?? err?.message ?? 'Invalid bot token. Check with @BotFather.',
      );
    } finally {
      setIsValidating(false);
    }
  }, [botToken, validateBotToken]);

  // Step 2: Create integration and register webhook
  const handleConnect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      // Create the integration record
      const integrationId = await createIntegration({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        platform: 'telegram',
        config: {
          botToken: botToken.trim(),
        },
        enabled: true,
      });

      // Register the webhook with Telegram
      const convexSiteUrl = window.location.origin.replace(
        /:\d+$/,
        '',
      );

      try {
        await registerWebhook({
          botToken: botToken.trim(),
          integrationId: integrationId as Id<'chatroom_integrations'>,
          convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? convexSiteUrl,
        });
      } catch {
        // Webhook registration may fail in dev (no public URL) — that's OK
        console.warn('Webhook registration failed — may need manual setup in production');
      }

      setStep('done');
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? 'Failed to create integration');
    } finally {
      setIsConnecting(false);
    }
  }, [botToken, chatroomId, createIntegration, registerWebhook]);

  return (
    <div className="border border-chatroom-border rounded-lg bg-chatroom-bg-secondary overflow-hidden">
      {/* Wizard Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-chatroom-border bg-chatroom-bg-tertiary/50">
        <div className="flex items-center gap-2">
          <span className="text-lg">✈️</span>
          <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
            Connect Telegram Bot
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 w-7 p-0 text-chatroom-text-muted"
        >
          <X size={14} />
        </Button>
      </div>

      <div className="p-4">
        {/* Step: Enter Token */}
        {step === 'enter-token' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-chatroom-text-muted">
                <span className="w-5 h-5 rounded-full bg-chatroom-accent/20 text-chatroom-accent flex items-center justify-center text-[10px] font-bold">
                  1
                </span>
                Create a bot via{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-chatroom-accent hover:underline inline-flex items-center gap-0.5"
                >
                  @BotFather
                  <ExternalLink size={10} />
                </a>
              </div>
              <div className="flex items-center gap-2 text-xs text-chatroom-text-muted">
                <span className="w-5 h-5 rounded-full bg-chatroom-accent/20 text-chatroom-accent flex items-center justify-center text-[10px] font-bold">
                  2
                </span>
                Paste your bot token below
              </div>
            </div>

            <div className="space-y-2">
              <Input
                type="password"
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={botToken}
                onChange={(e) => {
                  setBotToken(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
                className="font-mono text-xs bg-chatroom-bg-primary border-chatroom-border"
              />
              {error && (
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleValidate}
                disabled={isValidating || !botToken.trim()}
                className="text-xs gap-1.5"
              >
                {isValidating ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    Validate Token
                    <ChevronRight size={12} />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Confirm Bot */}
        {step === 'confirm' && botInfo && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5 dark:bg-green-500/10 border border-green-500/20">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Bot size={20} className="text-green-500 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-chatroom-text-primary">
                  {botInfo.botName}
                </p>
                {botInfo.botUsername && (
                  <p className="text-xs text-chatroom-text-muted">
                    @{botInfo.botUsername}
                  </p>
                )}
              </div>
              <Check size={16} className="ml-auto text-green-500 dark:text-green-400" />
            </div>

            {error && (
              <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
            )}

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep('enter-token');
                  setBotInfo(null);
                  setError(null);
                }}
                className="text-xs"
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={isConnecting}
                className="text-xs gap-1.5"
              >
                {isConnecting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Power size={12} />
                    Connect Bot
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="space-y-4 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <Check size={24} className="text-green-500 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-chatroom-text-primary">
                Telegram connected!
              </p>
              <p className="text-xs text-chatroom-text-muted mt-1">
                Send a message to your bot to start receiving messages in this chatroom.
              </p>
            </div>
            <Button
              size="sm"
              onClick={onComplete}
              className="text-xs"
            >
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
