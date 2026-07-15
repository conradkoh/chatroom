'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useCallback } from 'react';

import { CommandOutputPanel } from './CommandOutputPanel';

import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { CommandPaletteOutputState } from '@/modules/chatroom/hooks/useCommandRunOutputV2';

interface CommandOutputModalProps {
  inlineCommand: CommandPaletteOutputState;
}

/**
 * Standalone modal wrapping the CommandOutputPanel.
 *
 * Isolated from the CommandPalette dialog: ESC on this modal closes only
 * the output panel, not the command palette behind it.
 */
export function CommandOutputModal({ inlineCommand }: CommandOutputModalProps) {
  const open = inlineCommand.commandName !== null;

  const handleOpenChange = useCallback(
    (val: boolean) => {
      if (!val) {
        inlineCommand.detach();
      }
    },
    [inlineCommand]
  );

  const handleEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      inlineCommand.detach();
    },
    [inlineCommand]
  );

  const handleStop = useCallback(() => {
    inlineCommand.stop();
  }, [inlineCommand]);

  const handleRunAgain = useCallback(() => {
    const { commandName, script } = inlineCommand;
    if (commandName && script) {
      inlineCommand.run(commandName, script);
    }
  }, [inlineCommand]);

  const handleClose = useCallback(() => {
    inlineCommand.detach();
  }, [inlineCommand]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={false}>
      <DialogPortal>
        <DialogPrimitive.Content
          forceMount
          onEscapeKeyDown={handleEscapeKeyDown}
          className={cn(
            // Position: top-anchored, matching CommandPalette position
            'fixed left-[50%] translate-x-[-50%] top-[10%] sm:top-[15%] z-50',
            'w-[600px] max-w-[90vw] h-[320px]',
            // Industrial theme: sharp corners, 2px adaptive border, drop shadow for depth
            'rounded-none border-2 border-chatroom-border shadow-lg',
            // Background
            'bg-chatroom-bg-primary overflow-hidden',
            // Animation: open instantly (duration-0), close with smooth fade+zoom-out
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=closed]:zoom-out-95',
            'data-[state=open]:duration-0 data-[state=closed]:duration-200',
            'data-[state=closed]:fill-mode-forwards',
            'data-[state=closed]:pointer-events-none'
          )}
        >
          <DialogPrimitive.Title className="sr-only">Command Output</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Output for {inlineCommand.commandName ?? 'command'}
          </DialogPrimitive.Description>

          {inlineCommand.commandName && (
            <CommandOutputPanel
              commandName={inlineCommand.commandName}
              status={inlineCommand.status}
              terminationReason={inlineCommand.terminationReason}
              output={inlineCommand.output}
              onStop={handleStop}
              onRunAgain={handleRunAgain}
              onClose={handleClose}
              onLoadMore={inlineCommand.loadMore}
              canLoadMore={inlineCommand.canLoadMore}
              fullOutputPending={inlineCommand.fullOutputPending}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
