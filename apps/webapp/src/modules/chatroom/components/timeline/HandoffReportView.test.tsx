import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HandoffReportView } from './HandoffReportView';

const SEVERITY_ACTION_CONTENT = `<handoff-overview>
## Summary
Test
</handoff-overview>

<handoff-proofs>
## Proof of Completion
Done
</handoff-proofs>

<handoff-direction>
## Key Technical Decisions
JWT
</handoff-direction>

<handoff-notes>
## Notes
None
</handoff-notes>

<handoff-action>
## Tech Debt Observed
- [high] Critical auth gap
- [low] Typo in comment

## Unresolved Decisions
- [medium] Pick caching strategy

## Manual steps
- [high] This should NOT get a chip
</handoff-action>`;

const STRUCTURED_CONTENT = `<handoff-overview>
## Summary
Implemented login

## What exists today
Users can log in with email/password
</handoff-overview>

<handoff-proofs>
## Proof of Completion
Done
</handoff-proofs>

<handoff-direction>
## Key Technical Decisions
Used JWT
</handoff-direction>

<handoff-notes>
## Notes
None
</handoff-notes>

<handoff-action>
## Unresolved Decisions
Pick auth provider
</handoff-action>`;

const CONTENT_WITH_SYSTEM_DESIGN = `<handoff-overview>
## Summary
Test
</handoff-overview>

<handoff-proofs>
## Proof of Completion
Done
</handoff-proofs>

<handoff-direction>
## Key Technical Decisions
JWT

## System Design
\`\`\`mermaid
flowchart TD
    A --> B
\`\`\`
</handoff-direction>

<handoff-notes>
## Notes
None
</handoff-notes>

<handoff-action>
## Tech Debt Observed
- [high] Critical
</handoff-action>`;

const CONTENT_WITH_NA_SYSTEM_DESIGN = `<handoff-overview>
## Summary
Test
</handoff-overview>

<handoff-proofs>
## Proof of Completion
Done
</handoff-proofs>

<handoff-direction>
## Key Technical Decisions
JWT

## System Design
Not Applicable
</handoff-direction>

<handoff-notes>
## Notes
</handoff-notes>

<handoff-action>
## Unresolved Decisions
Pick auth provider
</handoff-action>`;

const LEGACY_CONTENT = `## Summary
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
  // Structured format
  describe('structured', () => {
    it('renders overview content expanded by default', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.getByText('Implemented login')).toBeInTheDocument();
      expect(screen.getByText('Users can log in with email/password')).toBeInTheDocument();
    });

    it('renders action content expanded by default', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.getByText('Pick auth provider')).toBeInTheDocument();
    });

    it('proofs collapsed by default', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.queryByText('Proof of Completion')).not.toBeInTheDocument();
      expect(screen.getByText('Proofs (1)')).toBeInTheDocument();
    });

    it('direction collapsed by default', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.queryByText('Used JWT')).not.toBeInTheDocument();
    });

    it('notes collapsed by default', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.queryByText('None')).not.toBeInTheDocument();
    });

    it('renders all section labels with counts', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.getByText('Overview (2)')).toBeInTheDocument();
      expect(screen.getByText('Proofs (1)')).toBeInTheDocument();
      expect(screen.getByText('Direction (1)')).toBeInTheDocument();
      expect(screen.getByText('Notes (1)')).toBeInTheDocument();
      expect(screen.getByText('Action required (1)')).toBeInTheDocument();
    });
  });

  describe('System Design section', () => {
    it('renders System Design as separate section with count when heading present', () => {
      render(<HandoffReportView content={CONTENT_WITH_SYSTEM_DESIGN} />);
      expect(screen.getByText('System Design (1)')).toBeInTheDocument();
    });

    it('does not render System Design section when heading absent', () => {
      render(<HandoffReportView content={STRUCTURED_CONTENT} />);
      expect(screen.queryByText(/System Design/)).not.toBeInTheDocument();
    });

    it('renders System Design collapsed when N/A', () => {
      render(<HandoffReportView content={CONTENT_WITH_NA_SYSTEM_DESIGN} />);
      expect(screen.getByText('System Design (0)')).toBeInTheDocument();
      expect(screen.queryByText('flowchart')).not.toBeInTheDocument();
    });
  });

  describe('counts in labels', () => {
    it('direction shows correct count after System Design extraction', () => {
      render(<HandoffReportView content={CONTENT_WITH_SYSTEM_DESIGN} />);
      expect(screen.getByText('Direction (1)')).toBeInTheDocument();
    });

    it('notes with paragraph shows count 1', () => {
      render(<HandoffReportView content={CONTENT_WITH_SYSTEM_DESIGN} />);
      expect(screen.getByText('Notes (1)')).toBeInTheDocument();
    });

    it('notes all N/A shows count 0', () => {
      render(<HandoffReportView content={CONTENT_WITH_NA_SYSTEM_DESIGN} />);
      expect(screen.getByText('Notes (0)')).toBeInTheDocument();
    });
  });

  // Legacy format
  describe('legacy', () => {
    it('renders legacy summary', () => {
      render(<HandoffReportView content={LEGACY_CONTENT} variant="timeline" />);
      expect(screen.getByText('Implemented login feature')).toBeInTheDocument();
    });

    it('renders Proofs and Details buttons for legacy content', () => {
      render(<HandoffReportView content={LEGACY_CONTENT} variant="timeline" />);
      expect(screen.getByText('Proofs')).toBeInTheDocument();
      expect(screen.getByText('Details')).toBeInTheDocument();
    });

    it('details collapsed by default', () => {
      render(<HandoffReportView content={LEGACY_CONTENT} variant="timeline" />);
      expect(screen.queryByText('Used JWT')).not.toBeInTheDocument();
    });
  });

  it('renders raw toggle', () => {
    render(<HandoffReportView content={STRUCTURED_CONTENT} />);
    expect(screen.getByText('Raw')).toBeInTheDocument();
  });

  it('has data-testid', () => {
    render(<HandoffReportView content={STRUCTURED_CONTENT} />);
    expect(screen.getByTestId('handoff-report-view')).toBeInTheDocument();
  });

  describe('severity chips', () => {
    it('renders severity chips for prefixed bullets in action section', () => {
      render(<HandoffReportView content={SEVERITY_ACTION_CONTENT} />);
      expect(screen.getByTestId('severity-chip-high')).toBeInTheDocument();
      expect(screen.getByTestId('severity-chip-medium')).toBeInTheDocument();
      expect(screen.getByTestId('severity-chip-low')).toBeInTheDocument();
    });

    it('renders chip labels correctly', () => {
      render(<HandoffReportView content={SEVERITY_ACTION_CONTENT} />);
      expect(screen.getByTestId('severity-chip-high')).toHaveTextContent('high');
      expect(screen.getByTestId('severity-chip-medium')).toHaveTextContent('medium');
      expect(screen.getByTestId('severity-chip-low')).toHaveTextContent('low');
    });

    it('renders bullet text next to chip', () => {
      render(<HandoffReportView content={SEVERITY_ACTION_CONTENT} />);
      expect(screen.getByText('Critical auth gap')).toBeInTheDocument();
      expect(screen.getByText('Pick caching strategy')).toBeInTheDocument();
      expect(screen.getByText('Typo in comment')).toBeInTheDocument();
    });
  });
});
