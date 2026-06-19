'use client';

import { ErrorBoundary } from '@sentry/nextjs';

/**
 * SentryErrorBoundary — wraps application content to capture and report errors to Sentry.
 *
 * Only reports errors when NEXT_PUBLIC_SENTRY_DSN is configured via Sentry.init().
 * When no DSN is set, errors are silently swallowed (no-op).
 */
export function SentryErrorBoundary(props: React.PropsWithChildren<unknown>): React.ReactNode {
  return <ErrorBoundary {...props} />;
}
