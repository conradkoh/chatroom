import { describe, expect, it } from 'vitest';

import { stripHandoffXmlTags } from './stripHandoffXmlTags';

describe('stripHandoffXmlTags', () => {
  it('strips tags preserving inner markdown', () => {
    const input = '<handoff-overview>\n## Summary\nFoo\n</handoff-overview>';
    expect(stripHandoffXmlTags(input)).toBe('## Summary\nFoo');
  });

  it('is case-insensitive and supports attributes on open tag', () => {
    const input = '<HANDOFF-OVERVIEW foo="bar">\n## Summary\nFoo\n</handoff-overview>';
    expect(stripHandoffXmlTags(input)).toBe('## Summary\nFoo');
  });

  it('strips all handoff report tags', () => {
    const input = `<handoff-overview>## Summary</handoff-overview>
<handoff-proofs>## Proofs</handoff-proofs>
<handoff-direction>## Direction</handoff-direction>
<handoff-ux>- **Flows:** Too many clicks</handoff-ux>
<handoff-notes>## Notes</handoff-notes>
<handoff-action>## Action</handoff-action>
<handoff-details>## Details</handoff-details>`;
    const result = stripHandoffXmlTags(input);
    expect(result).toContain('## Summary');
    expect(result).toContain('## Proofs');
    expect(result).toContain('## Direction');
    expect(result).toContain('**Flows:** Too many clicks');
    expect(result).toContain('## Notes');
    expect(result).toContain('## Action');
    expect(result).toContain('## Details');
    expect(result).not.toContain('<handoff-');
  });

  it('strips envelope tags', () => {
    const input =
      '<user-message>User request</user-message>\n<grounding>Notes</grounding>\n<builder-handoff>## Goal\nDo it</builder-handoff>';
    const result = stripHandoffXmlTags(input);
    expect(result).toContain('User request');
    expect(result).toContain('## Goal');
    expect(result).not.toContain('<user-message>');
    expect(result).not.toContain('<grounding>');
  });

  it('removes HTML comments', () => {
    const input = '<!-- REQUIRED comment -->\n## Summary\nFoo';
    expect(stripHandoffXmlTags(input)).toBe('## Summary\nFoo');
  });

  it('leaves plain markdown unchanged', () => {
    const input = '## Summary\nJust a normal task';
    expect(stripHandoffXmlTags(input)).toBe('## Summary\nJust a normal task');
  });

  it('handles realistic multi-section handoff', () => {
    const input = `<handoff-overview>
## Summary
Implemented login

## What changed
Added auth
</handoff-overview>

<!-- UI collapses proofs -->
<handoff-proofs>
## Proof of Completion
Done
</handoff-proofs>

<handoff-direction>
## Key Technical Decisions
Used JWT
</handoff-direction>`;
    const result = stripHandoffXmlTags(input);
    expect(result).toContain('## Summary');
    expect(result).toContain('Implemented login');
    expect(result).toContain('## Key Technical Decisions');
    expect(result).not.toContain('<handoff-');
    expect(result).not.toContain('<!--');
  });
});
