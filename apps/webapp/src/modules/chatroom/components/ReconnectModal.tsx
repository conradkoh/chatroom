'use client';

import { generateAgentPrompt } from '@workspace/backend/prompts/base/webapp';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import React, { useCallback, memo, useMemo } from 'react';

import { CopyButton } from './CopyButton';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ParticipantInfo {
  role: string;
  status: string;
  readyUntil?: number;
  isExpired: boolean;
}

interface ReconnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  expiredRoles: string[];
  // participants prop is available for future use (e.g., showing status)
  participants?: ParticipantInfo[];
  onViewPrompt?: (role: string) => void;
}

export const ReconnectModal = memo(function ReconnectModal({
  isOpen,
  onClose,
  chatroomId,
  teamName,
  teamRoles,
  teamEntryPoint,
  expiredRoles,
  participants: _participants, // Reserved for future use
  onViewPrompt,
}: ReconnectModalProps) {
  // Generate prompts for expired roles
  const expiredRolePrompts = useMemo(() => {
    return expiredRoles.map((role) => ({
      role,
      prompt: generateAgentPrompt({
        chatroomId,
        role,
        teamName,
        teamRoles,
        teamEntryPoint,
        convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
      }),
    }));
  }, [chatroomId, teamName, teamRoles, teamEntryPoint, expiredRoles]);

  // Get first line of prompt for preview
  const getPromptPreview = useCallback((prompt: string): string => {
    const firstLine = prompt.split('\n')[0] || '';
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...';
    }
    return firstLine;
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle className="text-lg">Agents Disconnected</DialogTitle>
          </div>
          <DialogDescription className="text-sm">
            The following agents have disconnected and need to be reconnected. Copy the prompt for
            each agent and paste it into their terminal.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="flex flex-col gap-3 pb-4">
            {expiredRolePrompts.map(({ role, prompt }) => {
              const preview = getPromptPreview(prompt);

              return (
                <Card
                  key={role}
                  className="border-destructive/30 hover:border-destructive/50 transition-colors"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 text-destructive" />
                        <CardTitle className="text-sm font-bold uppercase tracking-wider">
                          {role}
                        </CardTitle>
                      </div>
                      <Badge variant="destructive" className="uppercase text-xs">
                        Disconnected
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0 flex flex-col gap-3">
                    {/* Prompt Preview */}
                    {onViewPrompt && (
                      <button
                        className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted transition-colors text-left"
                        onClick={() => onViewPrompt(role)}
                        title="Click to view full prompt"
                      >
                        <span className="font-mono text-xs text-muted-foreground truncate flex-1">
                          {preview}
                        </span>
                        <span className="text-xs font-medium text-primary ml-2 shrink-0">View</span>
                      </button>
                    )}

                    {/* Copy Button */}
                    <div className="flex justify-end">
                      <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <div className="w-full space-y-2 text-xs text-muted-foreground">
            <p className="font-medium">To reconnect each agent:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Copy the prompt using the button above</li>
              <li>Paste it into the agent&apos;s terminal</li>
              <li>
                Run{' '}
                <code className="bg-background px-1.5 py-0.5 text-primary font-mono">
                  wait-for-task
                </code>{' '}
                to reconnect
              </li>
            </ol>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
