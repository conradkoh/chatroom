import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DetailRow, EventDetails, MarkdownDetailBlock } from './shared';

describe('event detail wrapping', () => {
  it('allows unbroken detail values to shrink and wrap', () => {
    const longValue = 'a'.repeat(200);
    render(<DetailRow label="ID" value={longValue} mono />);
    const value = screen.getByText(longValue);
    expect(value).toHaveClass('min-w-0', 'flex-1', 'break-all', '[overflow-wrap:anywhere]');
  });

  it('allows markdown detail content to wrap unbroken tokens', () => {
    const longValue = `https://example.com/${'a'.repeat(160)}`;
    render(<MarkdownDetailBlock label="Content" content={longValue} />);
    const content = screen.getByText(longValue);
    expect(content).toBeInTheDocument();
    expect(content.parentElement?.parentElement).toHaveClass(
      'min-w-0',
      'break-words',
      '[overflow-wrap:anywhere]'
    );
  });

  it('allows the event detail shell to shrink', () => {
    render(
      <EventDetails title="Event" timestamp={0} type="event.type">
        <DetailRow label="Value" value="content" />
      </EventDetails>
    );
    expect(screen.getByText('Event').parentElement?.parentElement).toHaveClass('min-w-0');
    expect(screen.getByText('content').parentElement?.parentElement?.parentElement).toHaveClass(
      'min-w-0'
    );
  });
});
