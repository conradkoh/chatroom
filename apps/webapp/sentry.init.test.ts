import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock @sentry/nextjs before importing the config modules
const mockSentryInit = vi.fn();
const mockReplayIntegration = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: (...args: unknown[]) => mockSentryInit(...args),
  replayIntegration: () => mockReplayIntegration(),
  // Re-export other Sentry members as empty mocks
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  wrap: (fn: () => void) => fn,
}));

describe('Sentry initialization guard', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockSentryInit.mockReset();
    mockReplayIntegration.mockReset();
  });

  it('does not initialize Sentry client when NEXT_PUBLIC_SENTRY_DSN is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    const { initSentryClient } = await import('./src/lib/sentry/clientInit');
    initSentryClient();

    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  it('initializes Sentry client when NEXT_PUBLIC_SENTRY_DSN is set', async () => {
    const testDsn = 'https://test@example.com/789';
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', testDsn);
    vi.stubEnv('NODE_ENV', 'development');

    const { initSentryClient } = await import('./src/lib/sentry/clientInit');
    initSentryClient();

    expect(mockSentryInit).toHaveBeenCalledTimes(1);
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: testDsn,
        sendDefaultPii: false,
      })
    );
    expect(mockSentryInit.mock.calls[0]?.[0]).not.toHaveProperty('debug');
    expect(mockReplayIntegration).toHaveBeenCalled();
  });

  it('does not initialize Sentry when NEXT_PUBLIC_SENTRY_DSN is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    // Import the client config which runs Sentry.init conditionally
    await import('./sentry.client.config');

    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  it('does not initialize Sentry when NEXT_PUBLIC_SENTRY_DSN is empty string', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    await import('./sentry.client.config');

    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  it('initializes Sentry when NEXT_PUBLIC_SENTRY_DSN is set', async () => {
    const testDsn = 'https://test@example.com/123';
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', testDsn);

    await import('./sentry.client.config');

    expect(mockSentryInit).toHaveBeenCalledTimes(1);
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: testDsn,
      })
    );
  });

  it('does not initialize server Sentry when NEXT_PUBLIC_SENTRY_DSN is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    await import('./sentry.server.config');

    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  it('initializes server Sentry when NEXT_PUBLIC_SENTRY_DSN is set', async () => {
    const testDsn = 'https://test@example.com/456';
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', testDsn);

    await import('./sentry.server.config');

    expect(mockSentryInit).toHaveBeenCalledTimes(1);
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: testDsn,
        tracesSampleRate: 1,
      })
    );
    expect(mockSentryInit.mock.calls[0]?.[0]).not.toHaveProperty('integrations');
    expect(mockReplayIntegration).not.toHaveBeenCalled();
  });
});
