import { describe, expect, it } from 'vitest';
import { hasHandoffReport, parseHandoffReport } from './parseHandoffReport';

const SAMPLE_WITH_TAGS = `## Summary
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
  it('extracts summary, proofs, and details', () => {
    const result = parseHandoffReport(SAMPLE_WITH_TAGS);
    expect(result.hasReport).toBe(true);
    expect(result.summary).toContain('Implemented login feature');
    expect(result.proofs).toContain('Proof of Completion');
    expect(result.details).toContain('Key Technical Decisions');
  });

  it('returns hasReport false for plain markdown', () => {
    expect(hasHandoffReport(PLAIN_MARKDOWN)).toBe(false);
  });

  it('warns on unclosed handoff-proofs tag', () => {
    const result = parseHandoffReport('<handoff-proofs>content');
    expect(result.warnings.some((w) => w.includes('Unclosed'))).toBe(true);
  });

  it('handles case-insensitive tags', () => {
    const result = parseHandoffReport('<HANDOFF-PROOFS>content</HANDOFF-PROOFS>');
    expect(result.proofs).toBe('content');
  });

  it('returns empty warnings for valid content', () => {
    const result = parseHandoffReport(SAMPLE_WITH_TAGS);
    expect(result.warnings).toHaveLength(0);
  });
});
