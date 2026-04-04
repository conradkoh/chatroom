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

import { useEffect, useRef } from 'react';
import { Square, X, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal } from '@/components/ui/dialog';

interface TerminalOutputPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandName: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | null;
  output: string;
  onStop: () => void;
  onRestart?: () => void;
}

function StatusBadge({ status }: { status: TerminalOutputPanelProps['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <span className="flex items-center gap-1 text-yellow-500 dark:text-yellow-400 text-xs font-bold uppercase tracking-wider">
          <Loader2 size={12} className="animate-spin" />
          Pending
        </span>
      );
    case 'running':
      return (
        <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400 text-xs font-bold uppercase tracking-wider">
          <Loader2 size={12} className="animate-spin" />
          Running
        </span>
      );
    case 'completed':
      return (
        <span className="flex items-center gap-1 text-green-500 dark:text-green-400 text-xs font-bold uppercase tracking-wider">
          <CheckCircle2 size={12} />
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-red-500 dark:text-red-400 text-xs font-bold uppercase tracking-wider">
          <XCircle size={12} />
          Failed
        </span>
      );
    case 'stopped':
      return (
        <span className="flex items-center gap-1 text-orange-500 dark:text-orange-400 text-xs font-bold uppercase tracking-wider">
          <AlertTriangle size={12} />
          Stopped
        </span>
      );
    default:
      return null;
  }
}

export function TerminalOutputPanel({
  open,
  onOpenChange,
  commandName,
  status,
  output,
  onStop,
  onRestart,
}: TerminalOutputPanelProps) {
  const scrollRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  const isRunning = status === 'running' || status === 'pending';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        {/* Semi-transparent overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-[800px] max-w-[95vw] h-[500px] max-h-[80vh] translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b-2 border-chatroom-border bg-chatroom-bg-primary">
            <div className="flex items-center gap-3 min-w-0">
              <DialogPrimitive.Title className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary truncate">
                {commandName ?? 'Terminal'}
              </DialogPrimitive.Title>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isRunning && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Stop process"
                >
                  <Square size={12} />
                  Stop
                </button>
              )}
              {!isRunning && onRestart && (
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
          <pre
            ref={scrollRef}
            className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-green-400 dark:text-green-300 bg-black/90 whitespace-pre-wrap break-words"
          >
            {output || (status === 'pending' ? 'Waiting for process to start...\n' : '')}
            {isRunning && (
              <span className="text-chatroom-text-muted animate-pulse">▌</span>
            )}
          </pre>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
