'use client';

import { Loader2 } from 'lucide-react';

import { InlineFeedback, type Feedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ExportFeedbackProps {
  exporting: boolean;
  label: string;
  feedback: Feedback | null;
  onDismiss: () => void;
  /** Passed only when the current error is retryable; renders "Try again". */
  onRetry?: () => void;
  className?: string;
  'data-testid': string;
}

// fallow-ignore-next-line complexity
export function ExportFeedback({
  exporting,
  label,
  feedback,
  onDismiss,
  onRetry,
  className,
  'data-testid': testId,
}: ExportFeedbackProps) {
  if (!exporting && feedback === null) return null;
  return (
    <div data-testid={testId} className={cn('min-w-0 space-y-2 break-words', className)}>
      {exporting && (
        <p role="status" className="flex items-center gap-2 text-xs text-chatroom-text-muted">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          {label}
        </p>
      )}
      <InlineFeedback feedback={feedback} onDismiss={onDismiss} />
      {onRetry && feedback !== null && (
        <Button variant="outline" size="xs" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
