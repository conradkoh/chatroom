import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkQueuePreviewText } from './WorkQueuePreviewText';

describe('WorkQueuePreviewText', () => {
  it('renders with line-clamp-2 by default', () => {
    const { container } = render(<WorkQueuePreviewText content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(container.querySelector('.line-clamp-2')).toBeInTheDocument();
  });

  it('renders heading without ## markers', () => {
    const { container } = render(<WorkQueuePreviewText content="## Summary\nFoo" />);
    expect(container.textContent).toContain('Summary');
    expect(container.textContent).not.toContain('##');
  });

  it('bold segment has font-semibold class', () => {
    const { container } = render(<WorkQueuePreviewText content="## Bold" />);
    const boldSpan = container.querySelector('.font-semibold');
    expect(boldSpan).toBeInTheDocument();
    expect(boldSpan?.textContent).toBe('Bold');
  });

  it('returns null for empty content', () => {
    const { container } = render(<WorkQueuePreviewText content="" />);
    expect(container.innerHTML).toBe('');
  });
});
