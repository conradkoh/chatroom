import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HandoffEnvelopeView } from './HandoffEnvelopeView';

vi.mock('./TimelineMarkdownBody', () => ({
  TimelineMarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="section-markdown">{content}</div>
  ),
}));

const ENVELOPE = `<user-message>User request here</user-message>
<grounding>Research notes</grounding>
<builder-handoff>## Goal\nDo the thing</builder-handoff>`;

describe('HandoffEnvelopeView', () => {
  it('shows collapsed summary in timeline variant', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="timeline" />);
    expect(screen.getByText(/3 sections/)).toBeInTheDocument();
    expect(screen.getByText(/User request here/)).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-envelope-sections')).not.toBeInTheDocument();
  });

  it('expands sections on toggle click', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="timeline" />);
    fireEvent.click(screen.getByTestId('handoff-envelope-toggle'));
    expect(screen.getByTestId('handoff-envelope-sections')).toBeInTheDocument();
  });

  it('switches to raw view', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="detail" />);
    fireEvent.click(screen.getByTestId('handoff-raw-toggle'));
    expect(screen.getByTestId('handoff-raw-content')).toHaveTextContent('<user-message>');
  });
});
