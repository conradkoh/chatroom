'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef } from 'react';

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
 *
 * Open-grace guard: when the palette closes right after a command is selected,
 * Radix focus-restore moves focus outside this non-modal dialog, firing
 * `onFocusOutside` (and on some gestures `onPointerDownOutside`) within the same
 * interaction. These spurious dismisses flash the output modal closed. The guard
 * ignores outside-interaction dismissals during the brief open window.
 */
const OPEN_GRACE_MS = 300;
// fallow-ignore-next-line unused-export — consumed by CommandOutputModal.test.tsx
export { OPEN_GRACE_MS };

export function CommandOutputModal({ inlineCommand }: CommandOutputModalProps) {
  const open = inlineCommand.commandName !== null;

  const openedAtRef = useRef(0);
  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  const withinGrace = useCallback(() => Date.now() - openedAtRef.current < OPEN_GRACE_MS, []);

  const handlePointerDownOutside = useCallback(
    (event: Event) => {
      if (withinGrace()) event.preventDefault();
    },
    [withinGrace]
  );

  const handleFocusOutside = useCallback(
    (event: Event) => {
      if (withinGrace()) event.preventDefault();
    },
    [withinGrace]
  );

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
          onPointerDownOutside={handlePointerDownOutside}
          onFocusOutside={handleFocusOutside}
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
