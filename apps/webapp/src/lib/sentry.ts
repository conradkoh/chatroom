import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Disable in development when no DSN is set
    debug: process.env.NODE_ENV === 'production',
    // Set the environment to production for proper release tracking
    environment: process.env.NODE_ENV,
    // Tracing sample rate — adjust as needed
    tracesSampleRate: 1.0,
    // Set state extraction field to avoid sending PII
    sendDefaultPii: false,
  });
}
