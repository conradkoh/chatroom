import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HandoffStructuredContent } from './HandoffStructuredContent';

const ENVELOPE = `<user-message>User request here</user-message>
<grounding>Research notes</grounding>
<builder-handoff>## Goal\nDo the thing</builder-handoff>`;

const STRUCTURED_REPORT = `<handoff-overview>## Summary\nDone</handoff-overview>
<handoff-proofs>## Proof</handoff-proofs>
<handoff-direction>## Decisions\nJWT</handoff-direction>
<handoff-notes>## Notes\nNone</handoff-notes>
<handoff-action>## Tech Debt\nNone</handoff-action>`;

const PLANNING_REVIEW_OUTCOME = `<planning-review-outcome status="cancelled">
## Planning review cancelled
Body
</planning-review-outcome>`;

describe('HandoffStructuredContent', () => {
  it('renders HandoffEnvelopeView for envelope content', () => {
    render(<HandoffStructuredContent content={ENVELOPE} />);
    expect(screen.getByTestId('handoff-envelope-view')).toBeInTheDocument();
  });

  it('renders HandoffReportView for structured report', () => {
    render(<HandoffStructuredContent content={STRUCTURED_REPORT} />);
    expect(screen.getByTestId('handoff-report-view')).toBeInTheDocument();
  });

  it('renders PlanningReviewOutcomeView for planning-review-outcome content', () => {
    render(<HandoffStructuredContent content={PLANNING_REVIEW_OUTCOME} />);
    expect(screen.getByTestId('planning-review-outcome-view')).toBeInTheDocument();
  });

  it('renders fallback for plain markdown', () => {
    render(
      <HandoffStructuredContent
        content="## Plain"
        fallback={<div data-testid="fallback">fallback</div>}
      />
    );
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-envelope-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handoff-report-view')).not.toBeInTheDocument();
  });
});
