import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineRowErrorBoundary } from './TimelineRowErrorBoundary';

/** Test child: throws while `shouldThrow` is true, otherwise renders its label. */
function Thrower({ shouldThrow, label }: { shouldThrow: boolean; label: string }) {
  if (shouldThrow) throw new Error('boom');
  return <p>{label}</p>;
}

describe('TimelineRowErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isolates a failing row and leaves its sibling rendering', () => {
    render(
      <>
        <TimelineRowErrorBoundary messageId="a" content="row a content">
          <Thrower shouldThrow label="row a" />
        </TimelineRowErrorBoundary>
        <TimelineRowErrorBoundary messageId="b" content="row b content">
          <Thrower shouldThrow={false} label="row b" />
        </TimelineRowErrorBoundary>
      </>
    );

    expect(screen.getAllByTestId('timeline-row-error')).toHaveLength(1);
    expect(screen.getByText('This message could not be displayed.')).toBeInTheDocument();
    expect(screen.getByText('row b')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('clears the error when the message id changes', () => {
    const { rerender } = render(
      <TimelineRowErrorBoundary messageId="a" content="same content">
        <Thrower shouldThrow label="healthy row" />
      </TimelineRowErrorBoundary>
    );

    expect(screen.getByTestId('timeline-row-error')).toBeInTheDocument();

    rerender(
      <TimelineRowErrorBoundary messageId="a2" content="same content">
        <Thrower shouldThrow={false} label="healthy row" />
      </TimelineRowErrorBoundary>
    );

    expect(screen.getByText('healthy row')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-row-error')).not.toBeInTheDocument();
  });

  it('clears the error when the content changes', () => {
    const { rerender } = render(
      <TimelineRowErrorBoundary messageId="a" content="old content">
        <Thrower shouldThrow label="healthy row" />
      </TimelineRowErrorBoundary>
    );

    expect(screen.getByTestId('timeline-row-error')).toBeInTheDocument();

    rerender(
      <TimelineRowErrorBoundary messageId="a" content="new content">
        <Thrower shouldThrow={false} label="healthy row" />
      </TimelineRowErrorBoundary>
    );

    expect(screen.getByText('healthy row')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-row-error')).not.toBeInTheDocument();
  });

  it('keeps the fallback while the message id and content are unchanged', () => {
    const { rerender } = render(
      <TimelineRowErrorBoundary messageId="a" content="same content">
        <Thrower shouldThrow label="healthy row" />
      </TimelineRowErrorBoundary>
    );

    rerender(
      <TimelineRowErrorBoundary messageId="a" content="same content">
        <Thrower shouldThrow={false} label="healthy row" />
      </TimelineRowErrorBoundary>
    );

    expect(screen.getByTestId('timeline-row-error')).toBeInTheDocument();
    expect(screen.queryByText('healthy row')).not.toBeInTheDocument();
  });
});
