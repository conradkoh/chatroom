/**
 * list-templates Unit Tests
 *
 * The command is fully local (no auth, no Convex), so tests assert the pair
 * descriptor output and the exact pair-resolution errors from the backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printHandoffListTemplates } from './list-templates.js';

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

describe('handoff list-templates', () => {
  it('prints the duo planner → builder descriptor and template body', () => {
    printHandoffListTemplates({ from: 'planner', to: 'builder', mode: 'code', teamId: 'duo' });

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getLogOutput();
    expect(output).toContain(
      'Handoff template `planner` → `builder` (team: `duo`, mode: `code`, key: `duo:planner->builder@code`)'
    );
    expect(output).toContain('Send with: chatroom handoff');
    expect(output).toContain('Reply pair: `builder` → `planner`');
    expect(output).toContain('Delegation Brief');
  });

  it('prints Reply pair: none for the terminal user recipient', () => {
    printHandoffListTemplates({ from: 'planner', to: 'user', mode: 'chat', teamId: 'duo' });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getLogOutput()).toContain('Reply pair: none');
  });

  it('errors when --mode is missing after the pair resolves', () => {
    printHandoffListTemplates({ from: 'planner', to: 'user', teamId: 'duo' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain(
      '❌ handoff list-templates requires --mode (missing: --mode).'
    );
  });

  it('errors when --to is missing', () => {
    printHandoffListTemplates({ from: 'planner', teamId: 'duo' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain(
      '❌ handoff list-templates requires both --from and --to (missing: --to).'
    );
  });

  it('errors with legacy flags and the pair commands from that role', () => {
    printHandoffListTemplates({ legacyRole: 'planner', teamId: 'duo' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain('no longer accepts --role/--next-role');
    expect(getErrorOutput()).toContain(
      '--from="planner" --to="builder" --mode="<chat|code|code:enhanced>" --team-id="duo"'
    );
  });

  it('errors with nonzero exit for an unknown team', () => {
    printHandoffListTemplates({ from: 'planner', to: 'builder', mode: 'code', teamId: 'tri' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getErrorOutput()).toContain('Unknown team "tri". Known teams: duo, solo.');
  });
});
