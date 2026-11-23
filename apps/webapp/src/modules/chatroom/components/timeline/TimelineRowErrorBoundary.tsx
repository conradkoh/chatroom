'use client';

import type { ReactNode } from 'react';

import { ErrorBoundary } from '../ErrorBoundary';

interface TimelineRowErrorBoundaryProps {
  messageId: string;
  content: string;
  children: ReactNode;
}

/** Compact, muted, single-line fallback for one failing timeline row. */
function TimelineRowErrorFallback() {
  return (
    <div data-testid="timeline-row-error" className="px-4 py-2 text-sm text-chatroom-text-muted">
      This message could not be displayed.
    </div>
  );
}

/**
 * Isolates a single timeline row. A render failure shows the local fallback and leaves
 * sibling rows and the app shell alone. The boundary resets when the message id or content changes.
 * The reset key is a string because the boundary compares it with `Object.is`; a fresh
 * array or object would reset the error on every parent render.
 */
export function TimelineRowErrorBoundary({
  messageId,
  content,
  children,
}: TimelineRowErrorBoundaryProps) {
  return (
    <ErrorBoundary
      resetKey={JSON.stringify([messageId, content])}
      fallback={<TimelineRowErrorFallback />}
    >
      {children}
    </ErrorBoundary>
  );
}
