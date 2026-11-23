/**
 * plan view-template — Unit Tests
 *
 * The command is static: it prints the generated plan template and never exits.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { printPlanViewTemplate } from './view-template.js';

let logSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stdout(): string {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
}

describe('printPlanViewTemplate', () => {
  test('prints the plan template in one call and never exits', () => {
    printPlanViewTemplate();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = stdout();
    expect(output).toContain('# <plan title>');
    expect(output).toContain('## Phases');
    expect(output).toContain('#### Acceptance criteria');
    expect(output).toContain('CHATROOM_PLAN_END');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
