import { describe, expect, test } from 'vitest';

import { getBuilderHandbackTemplate } from './builder-handback-handoff-templates';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

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
    for (const kind of ['`typecheck`', '`lint`', '`unit tests`', '`integration tests`', '`e2e`']) {
      expect(body).toContain(`- ${kind} —`);
    }
    expect(body).toContain('not applicable: the brief');
  });

  test('timing report sits between code change verification and blockers, with every activity row and a total', () => {
    expect(body.indexOf('## Code Change Verification')).toBeLessThan(
      body.indexOf('## Timing report')
    );
    expect(body.indexOf('## Timing report')).toBeLessThan(body.indexOf('## Blockers / questions'));
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
