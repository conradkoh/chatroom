import { describe, expect, test } from 'vitest';

import { getBuilderDelegationBriefTemplate } from './builder-delegation-handoff-templates';
import { VERIFICATION_KINDS } from '../utils/verification-kinds';

const DUO_PLANNER = { delegatorRole: 'planner', gatesOwner: 'self' } as const;

describe('getBuilderDelegationBriefTemplate', () => {
  test('duo brief offers focused and round-final scope and defaults to focused guidance', () => {
    const body = getBuilderDelegationBriefTemplate(DUO_PLANNER);

    expect(getBuilderDelegationBriefTemplate({ ...DUO_PLANNER, singlePass: false })).toBe(body);
    expect(body).toContain('## Verification flags');
    expect(body).toContain('Scope: <`focused` | `round-final`>');
    expect(body).toContain(
      "- `focused` — each run covers only the test files and workspaces that touch this brief's files."
    );
    expect(body).toContain(
      '- `round-final` — each run covers the full scope: the full unit suite and full integration suite of every workspace this brief changed'
    );
    expect(body).toContain(
      'set the `## Verification flags` scope to `focused` for each slice and to `round-final` for the final slice, which runs the full pass once.'
    );
    expect(body).not.toContain('## Verification scope');
    expect(body).toContain('Keep one slice ≈ one focused review surface.');
    expect(body).toContain(
      '- Name at least one end-to-end evidence that the feature works: a CLI run, an API call, a UI action, or the template render. Unit tests alone are insufficient for new features.'
    );
  });

  test('single-pass brief has one full scope definition and no scope choice', () => {
    const body = getBuilderDelegationBriefTemplate({
      delegatorRole: 'specifier',
      gatesOwner: 'coordinator',
      singlePass: true,
    });

    expect(body).toContain('## Verification flags');
    expect(body).toContain("This is the work package's only builder brief");
    expect(body).toContain(
      'Scope: `full` — each run covers the full scope: the full unit suite and full integration suite of every workspace this brief changed'
    );
    expect(body).not.toContain('Scope: <`focused`');
    expect(body).not.toContain('`round-final`');
    expect(body.indexOf('## Verification flags')).toBeLessThan(body.indexOf('## What to avoid'));
  });

  test.each([false, true])(
    'end-to-end line names alternative evidence when e2e is not applicable (singlePass=%s)',
    (singlePass) => {
      const body = getBuilderDelegationBriefTemplate({ ...DUO_PLANNER, singlePass });

      expect(body).toContain('a CLI run, an API call, a UI action, or the template render');
      expect(body).toContain(
        'When the brief marks `e2e` `not applicable`, the Requirements must name which of these alternatives is the end-to-end evidence.'
      );
      expect(body).not.toContain('Include at least one end-to-end check');
      expect(body).not.toContain('When the brief marks e2e `required`');
    }
  );

  test.each([false, true])(
    'every kind is flagged in both variants (singlePass=%s)',
    (singlePass) => {
      const body = getBuilderDelegationBriefTemplate({ ...DUO_PLANNER, singlePass });

      expect(body).toContain('`typecheck` — **required**. Lightweight');
      expect(body).toContain('`lint` — **required**. Lightweight');
      expect(body).toContain('`unit tests` — **required** or **not applicable: <reason>**');
      expect(body).toContain('`integration tests` — **required** or **not applicable: <reason>**');
      expect(body).toContain('`e2e` — **required** or **not applicable: <reason>**');
    }
  );

  test.each([false, true])(
    'every shared kind reaches the flags line (singlePass=%s)',
    (singlePass) => {
      const body = getBuilderDelegationBriefTemplate({ ...DUO_PLANNER, singlePass });

      for (const kind of VERIFICATION_KINDS) {
        expect(body).toContain(`- \`${kind.label}\` — `);
      }
    }
  );
});
