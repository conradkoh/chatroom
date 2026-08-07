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
  it('shows section headers in timeline variant without outer collapse', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="timeline" />);
    expect(screen.getByTestId('handoff-envelope-sections')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-user-message')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-grounding')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-builder-handoff')).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-envelope-toggle')).not.toBeInTheDocument();
  });

  it('timeline sections are collapsed by default', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="timeline" />);
    expect(screen.queryByTestId('section-markdown')).not.toBeInTheDocument();
  });

  it('detail variant opens all sections by default', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="detail" />);
    const markdowns = screen.getAllByTestId('section-markdown');
    expect(markdowns.length).toBe(3);
    expect(markdowns[0]).toHaveTextContent('User request here');
    expect(markdowns[1]).toHaveTextContent('Research notes');
    expect(markdowns[2]).toHaveTextContent('Do the thing');
  });

  it('toggles individual section on click', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="timeline" />);
    const sectionToggle = screen
      .getByTestId('handoff-section-user-message')
      .querySelector('button');
    expect(sectionToggle).toBeTruthy();
    fireEvent.click(sectionToggle!);
    expect(screen.getByTestId('section-markdown')).toHaveTextContent('User request here');
  });

  it('switches to raw view', () => {
    render(<HandoffEnvelopeView content={ENVELOPE} variant="detail" />);
    fireEvent.click(screen.getByTestId('handoff-raw-toggle'));
    expect(screen.getByTestId('handoff-raw-content')).toHaveTextContent('<user-message>');
  });
});
