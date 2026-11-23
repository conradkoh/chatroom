import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

/** Test child: throws while `shouldThrow` is true, otherwise renders its label. */
function Thrower({ shouldThrow, label }: { shouldThrow: boolean; label: string }) {
  if (shouldThrow) throw new Error('boom');
  return <p>{label}</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the sticky error and the default Reload fallback when no resetKey is given', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Thrower shouldThrow label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <Thrower shouldThrow={false} label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('healthy')).not.toBeInTheDocument();
  });

  it('keeps a custom fallback sticky when no resetKey is given', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={<p>row failed</p>}>
        <Thrower shouldThrow label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('row failed')).toBeInTheDocument();

    rerender(
      <ErrorBoundary fallback={<p>row failed</p>}>
        <Thrower shouldThrow={false} label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('row failed')).toBeInTheDocument();
    expect(screen.queryByText('healthy')).not.toBeInTheDocument();
  });

  it('keeps the fallback while the resetKey is unchanged', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={<p>row failed</p>}>
        <Thrower shouldThrow label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('row failed')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="a" fallback={<p>row failed</p>}>
        <Thrower shouldThrow={false} label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('row failed')).toBeInTheDocument();
    expect(screen.queryByText('healthy')).not.toBeInTheDocument();
  });

  it('clears the error and renders children again when the resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={<p>row failed</p>}>
        <Thrower shouldThrow label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('row failed')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="b" fallback={<p>row failed</p>}>
        <Thrower shouldThrow={false} label="healthy" />
      </ErrorBoundary>
    );

    expect(screen.getByText('healthy')).toBeInTheDocument();
    expect(screen.queryByText('row failed')).not.toBeInTheDocument();
  });
});
