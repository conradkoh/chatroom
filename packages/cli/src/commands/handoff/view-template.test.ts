/**
 * view-template Unit Tests
 *
 * The command is fully local (no auth, no Convex), so tests assert the pair
 * template output and the exact pair-resolution errors from the backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printHandoffViewTemplate } from './view-template.js';

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getLogOutput(): string {
  return logSpy.mock.calls.map((call: unknown[]) => (call as string[]).join(' ')).join('\n');
}

function getErrorOutput(): string {
  return errorSpy.mock.calls.map((call: unknown[]) => (call as string[]).join(' ')).join('\n');
}

describe('handoff view-template', () => {
  it('prints the duo planner → builder delegation brief', () => {
    printHandoffViewTemplate({ from: 'planner', to: 'builder', teamId: 'duo' });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getLogOutput()).toContain('Delegation Brief (Planner → Builder)');
  });

  it('errors when --to is missing', () => {
    printHandoffViewTemplate({ from: 'planner', teamId: 'duo' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain(
      '❌ handoff view-template requires both --from and --to (missing: --to).'
    );
    expect(getErrorOutput()).toContain('Example: chatroom handoff view-template');
  });

  it('errors with legacy flags and the rewritten pair command', () => {
    printHandoffViewTemplate({
      legacyRole: 'planner',
      legacyNextRole: 'builder',
      teamId: 'duo',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain('no longer accepts --role/--next-role');
    expect(getErrorOutput()).toContain('--from="planner" --to="builder" --team-id="duo"');
  });

  it('errors with nonzero exit for an unknown team', () => {
    printHandoffViewTemplate({ from: 'planner', to: 'builder', teamId: 'tri' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain('Unknown team "tri". Known teams: duo, solo.');
  });
});
