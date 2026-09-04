import { describe, expect, it } from 'vitest';

import { hasHandoffEnvelope, parseHandoffEnvelope } from './parseHandoffEnvelope';

const SAMPLE = `<user-message>
Fix the login bug
</user-message>

<additional-context>
Must preserve the existing session behavior
</additional-context>

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
  it('extracts all four sections in canonical order', () => {
    const result = parseHandoffEnvelope(SAMPLE);
    expect(result.hasEnvelope).toBe(true);
    expect(result.sections).toHaveLength(4);
    expect(result.sections.map((section) => section.id)).toEqual([
      'user-message',
      'additional-context',
      'grounding',
      'builder-handoff',
    ]);
    expect(result.sections[0].body).toContain('Fix the login bug');
    expect(result.sections[1].body).toContain('Must preserve the existing session behavior');
    expect(result.sections[2].body).toContain('Checked auth.ts and session.ts');
    expect(result.sections[3].body).toContain('new_session');
  });

  it('omits empty additional-context bodies', () => {
    const result = parseHandoffEnvelope(
      '<user-message>hi</user-message>\n<additional-context></additional-context>\n<grounding>notes</grounding>'
    );
    expect(result.sections.map((section) => section.id)).toEqual(['user-message', 'grounding']);
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
