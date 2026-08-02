'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useCallback } from 'react';

import { CommandOutputPanel } from './CommandOutputPanel';
import { CommandDialogContent } from '../shared/CommandDialogContent';

import { Dialog, DialogPortal } from '@/components/ui/dialog';
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
        <CommandDialogContent
          open={open}
          onEscapeKeyDown={handleEscapeKeyDown}
          className="h-[320px]"
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
        </CommandDialogContent>
      </DialogPortal>
    </Dialog>
  );
}
