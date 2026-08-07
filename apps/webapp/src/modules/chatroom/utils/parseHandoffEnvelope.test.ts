import { describe, expect, it } from 'vitest';
import { hasHandoffEnvelope, parseHandoffEnvelope } from './parseHandoffEnvelope';

const SAMPLE = `<user-message>
Fix the login bug
</user-message>

<grounding>
Checked auth.ts and session.ts
</grounding>

<builder-handoff>
## Summary
Fix login redirect

## Session Augmentation
// data:agent.session_augmentation=new_session
</builder-handoff>`;

describe('parseHandoffEnvelope', () => {
  it('extracts all three sections', () => {
    const result = parseHandoffEnvelope(SAMPLE);
    expect(result.hasEnvelope).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].body).toContain('Fix the login bug');
    expect(result.sections[2].body).toContain('new_session');
  });

  it('returns hasEnvelope false for plain markdown handoff', () => {
    expect(hasHandoffEnvelope('## Summary\nJust a normal handoff')).toBe(false);
  });

  it('warns on unclosed tag', () => {
    const result = parseHandoffEnvelope('<user-message>hello\n<grounding>world');
    expect(result.warnings.some((w) => w.includes('Unclosed'))).toBe(true);
  });

  it('handles case-insensitive tags', () => {
    const result = parseHandoffEnvelope('<USER-MESSAGE>hi</USER-MESSAGE>');
    expect(result.sections[0]?.body).toBe('hi');
  });
});
