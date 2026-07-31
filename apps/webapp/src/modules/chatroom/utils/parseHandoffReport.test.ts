import { describe, expect, it } from 'vitest';

import { hasHandoffReport, parseHandoffReport } from './parseHandoffReport';

const STRUCTURED_CONTENT = `<handoff-overview>
## Summary
Implemented login

## What exists today
Users can log in
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
## Tech Debt Observed
None
</handoff-action>`;

const CONTENT_WITH_UX = `${STRUCTURED_CONTENT}

<handoff-ux>
- **Flows:** Too many clicks
- **Patterns:** Use existing dialog
</handoff-ux>`;

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

const PLAIN_MARKDOWN = `## Summary
Just a normal handoff without XML tags`;

describe('parseHandoffReport', () => {
  // Structured format
  it('detects structured format from handoff-overview tag', () => {
    const result = parseHandoffReport(STRUCTURED_CONTENT);
    expect(result.format).toBe('structured');
    expect(result.hasReport).toBe(true);
  });

  it('extracts all 5 structured sections', () => {
    const result = parseHandoffReport(STRUCTURED_CONTENT);
    expect(result.overview).toContain('Implemented login');
    expect(result.proofs).toContain('Proof of Completion');
    expect(result.direction).toContain('Used JWT');
    expect(result.notes).toContain('None');
    expect(result.action).toContain('Tech Debt Observed');
  });

  it('returns null ux when handoff-ux tag absent', () => {
    const result = parseHandoffReport(STRUCTURED_CONTENT);
    expect(result.ux).toBeNull();
  });

  it('extracts ux section from handoff-ux tag', () => {
    const result = parseHandoffReport(CONTENT_WITH_UX);
    expect(result.ux).toContain('**Flows:** Too many clicks');
    expect(result.ux).toContain('**Patterns:** Use existing dialog');
  });

  it('overview section populates summary for structured format', () => {
    const result = parseHandoffReport(STRUCTURED_CONTENT);
    expect(result.summary).toContain('Implemented login');
  });

  // Legacy format
  it('detects legacy format from handoff-proofs tag', () => {
    const result = parseHandoffReport(LEGACY_CONTENT);
    expect(result.format).toBe('legacy');
    expect(result.hasReport).toBe(true);
  });

  it('extracts legacy proofs and details sections', () => {
    const result = parseHandoffReport(LEGACY_CONTENT);
    expect(result.proofs).toContain('Proof of Completion');
    expect(result.details).toContain('Used JWT');
    expect(result.summary).toContain('Implemented login feature');
  });

  // No tags
  it('returns hasReport false for plain markdown', () => {
    expect(hasHandoffReport(PLAIN_MARKDOWN)).toBe(false);
  });

  // Warnings
  it('warns on unclosed tags', () => {
    const result = parseHandoffReport('<handoff-overview>content');
    expect(result.warnings.some((w) => w.includes('Unclosed'))).toBe(true);
  });

  it('handles case-insensitive tags', () => {
    const result = parseHandoffReport('<HANDOFF-OVERVIEW>content</HANDOFF-OVERVIEW>');
    expect(result.overview).toBe('content');
  });

  it('returns empty warnings for valid content', () => {
    const result = parseHandoffReport(STRUCTURED_CONTENT);
    expect(result.warnings).toHaveLength(0);
  });
});
