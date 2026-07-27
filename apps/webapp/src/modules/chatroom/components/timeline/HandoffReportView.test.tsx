import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HandoffReportView } from './HandoffReportView';

const CONTENT_WITH_TAGS = `## Summary
Implemented login feature

<handoff-proofs>
## Proof of Completion
Done
</handoff-proofs>

<handoff-details>
## Key Technical Decisions
Used JWT
</handoff-details>`;

describe('HandoffReportView', () => {
  it('renders summary prominently on timeline variant', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="timeline" />);
    expect(screen.getByText('Implemented login feature')).toBeInTheDocument();
  });

  it('proofs collapsed by default on timeline', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="timeline" />);
    expect(screen.queryByText('Proof of Completion')).not.toBeInTheDocument();
    expect(screen.getByText('Proofs')).toBeInTheDocument();
  });

  it('details collapsed by default on timeline', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="timeline" />);
    expect(screen.queryByText('Key Technical Decisions')).not.toBeInTheDocument();
  });

  it('proofs open by default on detail variant', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="detail" />);
    expect(screen.getByText('Proof of Completion')).toBeInTheDocument();
  });

  it('details collapsed by default on detail variant', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="detail" />);
    expect(screen.queryByText('Key Technical Decisions')).not.toBeInTheDocument();
  });

  it('renders raw toggle', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="timeline" />);
    expect(screen.getByText('Raw')).toBeInTheDocument();
  });

  it('has data-testid', () => {
    render(<HandoffReportView content={CONTENT_WITH_TAGS} variant="timeline" />);
    expect(screen.getByTestId('handoff-report-view')).toBeInTheDocument();
  });
});
