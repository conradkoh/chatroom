'use client';

import * as Sentry from '@sentry/nextjs';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

function getClientStatus(): { initialized: boolean; dsnConfigured: boolean } {
  const dsnConfigured = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const client = Sentry.getClient();
  return { initialized: Boolean(client), dsnConfigured };
}

export default function SentryErrorTestPage() {
  const initialStatus = useMemo(() => getClientStatus(), []);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const handleCapture = async (type: 'message' | 'exception') => {
    const status = getClientStatus();

    if (!status.dsnConfigured) {
      toast.error(
        'NEXT_PUBLIC_SENTRY_DSN is not set — restart dev server after adding it to .env.local'
      );
      return;
    }

    if (!status.initialized) {
      toast.error(
        'Sentry client SDK is not initialized. Check instrumentation-client.ts is present and restart dev server.'
      );
      return;
    }

    try {
      const eventId =
        type === 'message'
          ? Sentry.captureMessage('Sentry test message from /test/sentry-error')
          : Sentry.captureException(new Error('Sentry test exception from /test/sentry-error'));

      await Sentry.flush(2000);
      setLastEventId(eventId ?? null);
      toast.success(`Captured ${type} — event ID: ${eventId ?? 'unknown'}`);
    } catch (error) {
      toast.error(`Capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <div className="max-w-xl rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sentry local test</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Use this page to confirm local Sentry ingestion before committing the Sentry integration.
        </p>

        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <p>DSN configured: {initialStatus.dsnConfigured ? 'yes' : 'no'}</p>
          <p>Client SDK initialized: {initialStatus.initialized ? 'yes' : 'no'}</p>
          {lastEventId ? <p className="mt-1">Last event ID: {lastEventId}</p> : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => void handleCapture('message')}
          >
            Send test message
          </button>

          <button
            type="button"
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void handleCapture('exception')}
          >
            Send test exception
          </button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Filter Network tab for &quot;sentry&quot; or &quot;ingest&quot; to confirm transport.
          Remove this route before committing.
        </p>
      </div>
    </main>
  );
}
