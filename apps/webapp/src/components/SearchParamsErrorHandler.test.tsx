import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchParamsErrorHandler } from './SearchParamsErrorHandler';

/** Only the Next.js router port is substituted. */
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
}));

/** Sets the browser URL, then mirrors its query into the mocked useSearchParams. */
function setUrl(path: string) {
  window.history.replaceState({}, '', path);
  searchParams.current = new URLSearchParams(window.location.search);
}

describe('SearchParamsErrorHandler', () => {
  beforeEach(() => {
    setUrl('/login');
  });

  it('shows the decoded ?error= text as an alert and removes the param without reload', () => {
    setUrl('/login?error=Access%20denied');
    render(<SearchParamsErrorHandler />);

    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(window.location.search).toBe('');
  });

  it('decodes the ?error= value exactly once', () => {
    setUrl('/login?error=50%2525');
    render(<SearchParamsErrorHandler />);

    expect(screen.getByRole('alert')).toHaveTextContent(/^50%25$/);
  });

  it('shows 100% for ?error=100%25', () => {
    setUrl('/login?error=100%25');
    render(<SearchParamsErrorHandler />);

    expect(screen.getByRole('alert')).toHaveTextContent(/^100%$/);
  });

  it('does not throw on a bare % in the query', () => {
    setUrl('/login?error=100%');
    render(<SearchParamsErrorHandler />);

    expect(screen.getByRole('alert')).toHaveTextContent(/^100%$/);
  });

  it('renders nothing when there is no error param', () => {
    const { container } = render(<SearchParamsErrorHandler />);

    expect(container).toBeEmptyDOMElement();
  });

  it('clears the message when the user dismisses it', async () => {
    setUrl('/login?error=Access%20denied');
    render(<SearchParamsErrorHandler />);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
