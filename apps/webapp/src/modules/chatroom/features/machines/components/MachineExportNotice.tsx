'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { Loader2 } from 'lucide-react';

import type { MachineExportAction } from '../../transfer/hooks/useMachineExportAction';
import { MACHINE_LISTING_LABEL, machineExportingLabel } from '../../transfer/lib/transferCopy';

import { InlineFeedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';

// fallow-ignore-next-line complexity
export function MachineExportNotice({ action }: { action: MachineExportAction }) {
  const { phase, feedback, retryable, start, cancel, dismiss } = action;
  if (phase.kind === 'idle' && feedback === null) return null;

  return (
    <div
      data-testid="machine-export-notice"
      className="space-y-2 border-t border-chatroom-border px-3 py-3 sm:px-4"
    >
      {phase.kind !== 'idle' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="flex items-center gap-2 text-xs text-chatroom-text-primary">
              <Loader2 size={12} className="animate-spin text-chatroom-text-muted" aria-hidden />
              {phase.kind === 'listing'
                ? MACHINE_LISTING_LABEL
                : machineExportingLabel(phase.done, phase.total)}
            </p>
            <Button variant="outline" size="xs" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {phase.kind === 'exporting' && (
            // The shared `Progress` wrapper always appends its own default track, so a
            // customised track is composed from the primitive root (same as StorageUsageBar).
            <ProgressPrimitive.Root
              value={phase.done}
              max={phase.total}
              aria-label="Export progress"
              className="flex flex-wrap gap-0"
            >
              <ProgressTrack className="h-1.5 w-full rounded-none bg-chatroom-bg-tertiary">
                <ProgressIndicator className="h-full rounded-none bg-chatroom-accent transition-all" />
              </ProgressTrack>
            </ProgressPrimitive.Root>
          )}
        </div>
      )}
      <InlineFeedback
        feedback={feedback}
        onDismiss={dismiss}
        data-testid="machine-export-feedback"
      />
      {retryable && feedback !== null && feedback.tone === 'error' && (
        <Button variant="outline" size="xs" onClick={start}>
          Try again
        </Button>
      )}
    </div>
  );
}
