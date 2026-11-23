import { describe, expect, test } from 'vitest';

import { getBuilderHandbackTemplate } from './builder-handback-handoff-templates';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';
import { VERIFICATION_KINDS } from '../utils/verification-kinds';

const QUERY: HandoffTemplateQuery = {
  fromRole: 'builder',
  toRole: 'specifier',
  teamId: 'trio',
  chatroomId: 'test-chatroom-id',
  role: 'builder',
};

describe('getBuilderHandbackTemplate', () => {
  const body = getBuilderHandbackTemplate(QUERY);

  test('drops the blanket run-tests attestation', () => {
    expect(body).not.toContain('I confirm that I have run typecheck and tests for the project');
    expect(body).toContain('the lightweight checks (typecheck, and lint) ran');
    expect(body).toContain('marked `required` ran');
  });

  test('records each verification kind with ran, not run, or not applicable', () => {
    for (const kind of VERIFICATION_KINDS) {
      expect(body).toContain(`- \`${kind.label}\` —`);
    }
    expect(body).toContain('not applicable: the brief');
  });

  test('timing report lists a row for every shared verification kind', () => {
    for (const kind of VERIFICATION_KINDS) {
      expect(body).toContain(`- ${kind.timingLabel}:`);
    }
  });

  test('typecheck and lint are always run, never recorded as not run', () => {
    expect(body).toContain('record their command and result only');

    for (const label of ['typecheck', 'lint']) {
      const resultLine = body.split('\n').find((line) => line.includes(`- \`${label}\` —`));
      expect(resultLine).toBeDefined();
      expect(resultLine).not.toContain('not run');
    }

    for (const label of ['Typecheck', 'Lint']) {
      const timingRow = body.split('\n').find((line) => line.startsWith(`- ${label}:`));
      expect(timingRow).toBeDefined();
      expect(timingRow).not.toContain('not run');
    }
  });

  test('timing report sits between code change verification and blockers, with every activity row and a total', () => {
    expect(body.indexOf('## Code Change Verification')).toBeLessThan(
      body.indexOf('## Timing report')
    );
    expect(body.indexOf('## Timing report')).toBeLessThan(
      body.indexOf('## Blockers / questions\n')
    );
    for (const row of [
      'Brief reading',
      'Implementation (code and tests written)',
      'Typecheck',
      'Lint',
      'Unit tests',
      'Integration tests',
      'E2E',
      'Commits',
      'Push and PR',
      'Other activities',
      'Total',
    ]) {
      expect(body).toContain(`- ${row}:`);
    }
    expect(body).toContain('`not run`');
    expect(body).toContain('`not applicable`');
  });
});
