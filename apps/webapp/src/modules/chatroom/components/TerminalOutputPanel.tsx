/**
 * TerminalOutputPanel — displays command execution output in a terminal-like view.
 *
 * Features:
 * - Auto-scrolling terminal output
 * - Command status indicator (running/completed/failed/stopped)
 * - Stop button for running processes
 * - Monospace font, dark theme
 */

'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Square, X, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Z_MODAL } from './shared/overlayLayers';
import { StatusBadge } from '../features/run-command/components/StatusBadge';
import { TerminalView } from '../features/run-command/components/TerminalView';
import type { CommandRun } from '../features/run-command/types/run';
import { isActiveRun } from '../features/run-command/utils/run-status';

import { Dialog, DialogPortal } from '@/components/ui/dialog';

interface TerminalOutputPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandName: string | null;
  status: CommandRun['status'] | null;
  output: string;
  onStop: () => void;
  onRestart?: () => void;
  terminationReason?: string;
}

export function TerminalOutputPanel({
  open,
  onOpenChange,
  commandName,
  status,
  output,
  onStop,
  onRestart,
  terminationReason,
}: TerminalOutputPanelProps) {
  const scrollRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  const active = isActiveRun(status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        {/* Semi-transparent overlay */}
        <DialogPrimitive.Overlay
          className={`fixed inset-0 ${Z_MODAL} bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0`}
        />

        <DialogPrimitive.Content
          className={`fixed left-[50%] top-[50%] ${Z_MODAL} w-[800px] max-w-[95vw] h-[500px] max-h-[80vh] translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-200`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b-2 border-chatroom-border bg-chatroom-bg-primary">
            <div className="flex items-center gap-3 min-w-0">
              <DialogPrimitive.Title className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary truncate">
                {commandName ?? 'Terminal'}
              </DialogPrimitive.Title>
              {status && <StatusBadge status={status} terminationReason={terminationReason} />}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {active && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Stop process"
                >
                  <Square size={12} />
                  Stop
                </button>
              )}
              {!active && onRestart && (
                <button
                  onClick={onRestart}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 hover:bg-blue-500/10 transition-colors"
                  title="Restart command"
                >
                  <RefreshCw size={12} />
                  Restart
                </button>
              )}
              <DialogPrimitive.Close className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1">
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Accessible description (sr-only) */}
          <DialogPrimitive.Description className="sr-only">
            Terminal output for {commandName ?? 'command'}
          </DialogPrimitive.Description>

          {/* Terminal output area */}
          <TerminalView ref={scrollRef} output={output} status={status} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
