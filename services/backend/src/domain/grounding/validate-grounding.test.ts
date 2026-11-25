/**
 * validateGrounding — unit tests
 *
 * Every fixture is literal markdown and every expected code/line is written by
 * hand, so the assertions describe the contract rather than the implementation.
 */

import { describe, expect, it } from 'vitest';

import { GROUNDING_MAX_CHARS } from './grounding-template-spec';
import { validateGrounding } from './validate-grounding';

const VALID_FIXTURE = [
  '# Grounding: Add grounding messages',
  '',
  '## Request',
  '- Add grounding messages to the handoff flow. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
  '',
  '## Relevant files',
  '- `services/backend/convex/plans.ts` — plan publish and read functions, as observed.',
  '',
  '## Entry points',
  '- `publish` in `services/backend/convex/plans.ts` — mutation called by the CLI, as observed.',
  '',
  '## Flow',
  '```mermaid',
  'sequenceDiagram',
  '  CLI->>plans: publish',
  '```',
  '',
  '## Prior records',
  '- None observed.',
  '',
  '## Not inspected',
  '- None observed.',
].join('\n');

/** Compact `[code, line]` view of a rejection, for literal assertions. */
function codeLines(result: ReturnType<typeof validateGrounding>): [string, number][] {
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors.map((error) => [error.code, error.line]);
}

describe('validateGrounding', () => {
  it('accepts the canonical fixture', () => {
    expect(validateGrounding(VALID_FIXTURE)).toEqual({ ok: true });
  });

  it('treats heading-like lines inside a mermaid fence as content', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '```mermaid',
      'sequenceDiagram',
      '# not a heading',
      '  CLI->>plans: publish',
      '```',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
    ].join('\n');

    expect(validateGrounding(content)).toEqual({ ok: true });
  });

  it('reports a missing section at line 1', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '```mermaid',
      'sequenceDiagram',
      '  CLI->>plans: publish',
      '```',
      '',
      '## Prior records',
      '- None observed.',
    ].join('\n');

    const result = validateGrounding(content);
    expect(codeLines(result)).toEqual([['GROUNDING_SECTION_MISSING', 1]]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.message).toBe('Missing section "Not inspected"');
    }
  });

  it('reports a section out of order at its heading line', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Flow',
      '```mermaid',
      'sequenceDiagram',
      '  CLI->>plans: publish',
      '```',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
    ].join('\n');

    const result = validateGrounding(content);
    expect(codeLines(result)).toEqual([['GROUNDING_SECTION_ORDER', 15]]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toBe('Section "Entry points" is out of order');
    }
  });

  it('reports a duplicate section at its heading line', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Request',
      '- A duplicate heading.',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '```mermaid',
      'sequenceDiagram',
      '  CLI->>plans: publish',
      '```',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
    ].join('\n');

    const result = validateGrounding(content);
    expect(codeLines(result)).toEqual([['GROUNDING_SECTION_ORDER', 6]]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toBe('Duplicate section "Request"');
    }
  });

  it('reports an unknown section at its heading line', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '```mermaid',
      'sequenceDiagram',
      '  CLI->>plans: publish',
      '```',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
      '',
      '## Conclusion',
      '- A section the template does not define.',
    ].join('\n');

    const result = validateGrounding(content);
    expect(codeLines(result)).toEqual([['GROUNDING_SECTION_ORDER', 24]]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toBe('Unknown section "Conclusion"');
    }
  });

  it('reports a missing H1 title at line 1', () => {
    const content = [
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '- None observed.',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
    ].join('\n');

    expect(codeLines(validateGrounding(content))).toEqual([['GROUNDING_TITLE_MISSING', 1]]);
  });

  it('reports an empty required section at its heading line', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '- None observed.',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
    ].join('\n');

    expect(codeLines(validateGrounding(content))).toEqual([['GROUNDING_SECTION_EMPTY', 3]]);
  });

  it('rejects "None observed." where the token is not allowed', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- None observed.',
      '',
      '## Entry points',
      '- None observed.',
      '',
      '## Flow',
      '- None observed.',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
    ].join('\n');

    expect(codeLines(validateGrounding(content))).toEqual([['GROUNDING_SECTION_EMPTY', 6]]);
  });

  it('accepts a bare "None observed." in sections where the token is allowed', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      'None observed.',
      '',
      '## Prior records',
      'None observed.',
      '',
      '## Not inspected',
      'None observed.',
    ].join('\n');

    expect(validateGrounding(content)).toEqual({ ok: true });
  });

  it('reports an unclosed fence at its opening line', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '- Add grounding messages. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '- None observed.',
      '',
      '## Prior records',
      '- None observed.',
      '',
      '## Not inspected',
      '- None observed.',
      '',
      '```mermaid',
      'sequenceDiagram',
    ].join('\n');

    expect(codeLines(validateGrounding(content))).toEqual([['GROUNDING_FENCE_UNCLOSED', 21]]);
  });

  it('reports only GROUNDING_TOO_LONG for over-long content', () => {
    const content = 'x'.repeat(GROUNDING_MAX_CHARS + 1);

    expect(codeLines(validateGrounding(content))).toEqual([['GROUNDING_TOO_LONG', 1]]);
  });

  it('reports independent errors in a single pass', () => {
    const content = [
      '# Grounding: Add grounding messages',
      '',
      '## Request',
      '',
      '## Relevant files',
      '- `services/backend/convex/plans.ts` — as observed.',
      '',
      '## Entry points',
      '- `publish` — as observed.',
      '',
      '## Flow',
      '- None observed.',
      '',
      '## Prior records',
      '- None observed.',
    ].join('\n');

    expect(codeLines(validateGrounding(content))).toEqual([
      ['GROUNDING_SECTION_MISSING', 1],
      ['GROUNDING_SECTION_EMPTY', 3],
    ]);
  });
});
