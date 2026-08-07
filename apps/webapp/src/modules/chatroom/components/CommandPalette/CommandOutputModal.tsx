'use client';

import { useCallback, useEffect, useRef } from 'react';

import { CommandOutputPanel } from './CommandOutputPanel';
import { CommandDialogContent, CommandDialogRoot } from '../shared/CommandDialogContent';

import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
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
 * focus-restore moves focus outside this non-modal dialog, firing
 * `onFocusOutside` (and on some gestures `onPointerDownOutside`) within the same
 * interaction. These spurious dismisses flash the output modal closed. The guard
 * ignores outside-interaction dismissals during the brief open window.
 */
const OPEN_GRACE_MS = 300;
// fallow-ignore-next-line unused-export
export { OPEN_GRACE_MS };

type DialogChangeEventDetails = {
  reason: string;
  event: Event;
  cancel: () => void;
};

function isOutsideDismissReason(reason: string): boolean {
  return reason === 'outside-press' || reason === 'focus-out';
}

// fallow-ignore-next-line complexity
function handleDialogOpenChange(
  val: boolean,
  eventDetails: DialogChangeEventDetails | undefined,
  withinGrace: () => boolean,
  onPointerDownOutside: (event: Event) => void,
  onFocusOutside: (event: Event) => void,
  detach: () => void
): void {
  if (val) return;

  if (eventDetails && isOutsideDismissReason(eventDetails.reason)) {
    if (withinGrace()) {
      eventDetails.cancel();
      return;
    }
    if (eventDetails.reason === 'outside-press') {
      onPointerDownOutside(eventDetails.event);
    } else {
      onFocusOutside(eventDetails.event);
    }
  }

  detach();
}

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
    (val: boolean, eventDetails?: DialogChangeEventDetails) => {
      handleDialogOpenChange(
        val,
        eventDetails,
        withinGrace,
        handlePointerDownOutside,
        handleFocusOutside,
        inlineCommand.detach
      );
    },
    [inlineCommand, handlePointerDownOutside, handleFocusOutside, withinGrace]
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

  // Base UI non-modal dialogs do not emit focus-out dismiss like Radix; mirror Radix
  // behavior so spurious focus moves close the panel after the open-grace window.
  useEffect(() => {
    if (!open) return;

    // fallow-ignore-next-line complexity
    const handleFocusIn = (event: FocusEvent) => {
      const popup = document.querySelector('[data-slot="command-dialog-content"]');
      const target = event.target as Node | null;
      if (!popup || !target || popup.contains(target)) return;

      if (withinGrace()) return;

      handleFocusOutside(event);
      inlineCommand.detach();
    };

    document.addEventListener('focusin', handleFocusIn, true);
    return () => document.removeEventListener('focusin', handleFocusIn, true);
  }, [open, handleFocusOutside, inlineCommand, withinGrace]);

  return (
    <CommandDialogRoot open={open} onOpenChange={handleOpenChange}>
      <CommandDialogContent
        open={open}
        onEscapeKeyDown={handleEscapeKeyDown}
        onPointerDownOutside={handlePointerDownOutside}
        onFocusOutside={handleFocusOutside}
        onBackdropDismiss={inlineCommand.detach}
        className="h-[320px]"
      >
        <DialogTitle className="sr-only">Command Output</DialogTitle>
        <DialogDescription className="sr-only">
          Output for {inlineCommand.commandName ?? 'command'}
        </DialogDescription>

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
    </CommandDialogRoot>
  );
}
