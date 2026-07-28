import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkQueuePreviewText } from './WorkQueuePreviewText';

describe('WorkQueuePreviewText', () => {
  it('renders with line-clamp-2 by default', () => {
    const { container } = render(<WorkQueuePreviewText content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(container.querySelector('.line-clamp-2')).toBeInTheDocument();
  });

  it('renders with line-clamp-3 when lines=3', () => {
    const { container } = render(<WorkQueuePreviewText content="Hello world" lines={3} />);
    expect(container.querySelector('.line-clamp-3')).toBeInTheDocument();
  });

  it('returns null for empty content', () => {
    const { container } = render(<WorkQueuePreviewText content="" />);
    expect(container.innerHTML).toBe('');
  });

  it('strips XML tags from handoff content', () => {
    const content = '<handoff-overview>## Summary\nFoo</handoff-overview>';
    render(<WorkQueuePreviewText content={content} />);
    expect(screen.getByText(/## Summary/)).toBeInTheDocument();
    expect(screen.queryByText(/<handoff-/)).not.toBeInTheDocument();
  });
});
