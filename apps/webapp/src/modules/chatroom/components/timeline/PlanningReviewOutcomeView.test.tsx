import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningReviewOutcomeView } from './PlanningReviewOutcomeView';

vi.mock('./TimelineMarkdownBody', () => ({
  TimelineMarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="outcome-markdown">{content}</div>
  ),
}));

const CANCELLED = `<planning-review-outcome status="cancelled">
## Planning review cancelled
Body content
</planning-review-outcome>`;

const OUTCOME_WITH_HANDOFF_SECTIONS = `<planning-review-outcome status="cancelled">
<handoff-overview>
## Summary
Assessment text
</handoff-overview>
<handoff-action>
## Risks
Edge case
</handoff-action>
</planning-review-outcome>`;

describe('PlanningReviewOutcomeView', () => {
  it('renders the view with inner markdown and no raw XML', () => {
    render(<PlanningReviewOutcomeView content={CANCELLED} variant="timeline" />);

    expect(screen.getByTestId('planning-review-outcome-view')).toBeInTheDocument();
    expect(screen.getByTestId('outcome-markdown')).toHaveTextContent(
      '## Planning review cancelled'
    );
    expect(screen.getByTestId('outcome-markdown')).toHaveTextContent('Body content');
    expect(screen.queryByText(/<planning-review-outcome/)).not.toBeInTheDocument();
  });

  it('renders inner handoff report sections via HandoffReportView', () => {
    render(<PlanningReviewOutcomeView content={OUTCOME_WITH_HANDOFF_SECTIONS} />);

    expect(screen.getByTestId('handoff-report-view')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-overview')).toBeInTheDocument();
    expect(screen.queryByText(/<handoff-overview/)).not.toBeInTheDocument();
  });

  it('shows a cancelled badge for cancelled status', () => {
    render(<PlanningReviewOutcomeView content={CANCELLED} />);
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('shows a failed badge for failed status', () => {
    render(
      <PlanningReviewOutcomeView
        content={
          '<planning-review-outcome status="failed">\n## Planning review failed\n</planning-review-outcome>'
        }
      />
    );
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('shows a neutral badge for unknown status', () => {
    render(
      <PlanningReviewOutcomeView
        content={
          '<planning-review-outcome status="weird">\n## Planning review\n</planning-review-outcome>'
        }
      />
    );
    expect(screen.getByText('review outcome')).toBeInTheDocument();
  });
});
