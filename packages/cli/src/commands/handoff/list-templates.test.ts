/**
 * list-templates Unit Tests
 *
 * The command is fully local (no auth, no Convex), so tests assert formatted
 * success output, the default duo team selection, and unknown-role/team errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printHandoffListTemplates } from './list-templates.js';

let exitSpy: any;
let logSpy: any;
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

describe('handoff list-templates', () => {
  it('prints the duo planner contract with receives/returns and outbound templates', () => {
    printHandoffListTemplates({ role: 'planner', teamId: 'duo' });

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('Handoff contract for `planner` (team: `duo`)');
    expect(output).toContain('Receives from:');
    expect(output).toContain('Returns to:');
    expect(output).toContain('- `planner` → `builder`');
    expect(output).toContain('- `planner` → `enhancer`');
    expect(output).toContain('- `planner` → `user`');
  });

  it('defaults team-id to duo when omitted', () => {
    printHandoffListTemplates({ role: 'planner' });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('(team: `duo`)');
  });

  it('errors with nonzero exit for an unknown role', () => {
    printHandoffListTemplates({ role: 'architect', teamId: 'duo' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('architect');
  });

  it('errors with nonzero exit for an unknown team', () => {
    printHandoffListTemplates({ role: 'planner', teamId: 'tri' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('No handoff contract for role "planner"');
  });
});
