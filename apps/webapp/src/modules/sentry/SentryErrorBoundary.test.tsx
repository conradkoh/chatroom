import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SentryErrorBoundary } from './SentryErrorBoundary';

describe('SentryErrorBoundary', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://test@example.com/123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders children when no error occurs', () => {
    render(
      <SentryErrorBoundary>
        <div data-testid="child">Test Content</div>
      </SentryErrorBoundary>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders children successfully', () => {
    const { container } = render(
      <SentryErrorBoundary>
        <div>Hello World</div>
      </SentryErrorBoundary>
    );

    expect(container.innerHTML).toContain('Hello World');
  });
});
