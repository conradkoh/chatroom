import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SentryErrorTestPage from './page';

const sentry = vi.hoisted(() => ({
  getClient: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
}));

// External port: the Sentry SDK.
vi.mock('@sentry/nextjs', () => sentry);

const MESSAGE_TEST = 'Sentry test message from /test/sentry-error';

describe('SentryErrorTestPage', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
    sentry.getClient.mockReturnValue({});
    sentry.captureMessage.mockReturnValue('event-message-1');
    sentry.captureException.mockReturnValue('event-exception-1');
    sentry.flush.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('shows the missing DSN as alert text and sends nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const user = userEvent.setup();
    render(<SentryErrorTestPage />);

    await user.click(screen.getByRole('button', { name: 'Send test message' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'NEXT_PUBLIC_SENTRY_DSN is not set — restart dev server after adding it to .env.local'
    );
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('shows an uninitialized SDK as alert text and sends nothing', async () => {
    sentry.getClient.mockReturnValue(undefined);
    const user = userEvent.setup();
    render(<SentryErrorTestPage />);

    await user.click(screen.getByRole('button', { name: 'Send test message' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sentry client SDK is not initialized. Check instrumentation-client.ts is present and restart dev server.'
    );
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('shows the captured event id as status text after a successful send', async () => {
    const user = userEvent.setup();
    render(<SentryErrorTestPage />);

    await user.click(screen.getByRole('button', { name: 'Send test message' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Captured message — event ID: event-message-1'
    );
    expect(sentry.captureMessage).toHaveBeenCalledWith(MESSAGE_TEST);
    expect(sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('shows a failed exception send as alert text', async () => {
    sentry.captureException.mockImplementation(() => {
      throw new Error('network down');
    });
    const user = userEvent.setup();
    render(<SentryErrorTestPage />);

    await user.click(screen.getByRole('button', { name: 'Send test exception' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Capture failed: network down');
  });

  it('replaces the previous message on the next attempt', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const user = userEvent.setup();
    render(<SentryErrorTestPage />);

    await user.click(screen.getByRole('button', { name: 'Send test message' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
    await user.click(screen.getByRole('button', { name: 'Send test message' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Captured message — event ID: event-message-1'
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
