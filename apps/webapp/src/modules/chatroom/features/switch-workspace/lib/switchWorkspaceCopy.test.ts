import { describe, expect, it } from 'vitest';

import {
  CONFLICT_COPY,
  classifySwitchError,
  isSameWorkspace,
  normalizeWorkingDir,
  SKIP_REASON_COPY,
  stopSummaryLine,
} from './switchWorkspaceCopy';

describe('classifySwitchError', () => {
  it('maps WORKSPACE_SWITCH_CONFLICT to the conflict copy', () => {
    const result = classifySwitchError({
      data: { code: 'WORKSPACE_SWITCH_CONFLICT', message: 'x' },
    });

    expect(result).toEqual({ kind: 'conflict', message: CONFLICT_COPY });
  });

  it('maps WORKSPACE_ALREADY_BOUND to the conflict copy', () => {
    const result = classifySwitchError({ data: { code: 'WORKSPACE_ALREADY_BOUND' } });

    expect(result).toEqual({ kind: 'conflict', message: CONFLICT_COPY });
  });

  it('maps INVALID_WORKING_DIR to the invalid-path copy', () => {
    const result = classifySwitchError({ data: { code: 'INVALID_WORKING_DIR' } });

    expect(result).toEqual({
      kind: 'invalid-path',
      message: "That path isn't valid. Use an absolute folder path such as /Users/you/projects.",
    });
  });

  it.each(['MACHINE_NOT_FOUND', 'NOT_AUTHORIZED_MACHINE'])(
    'maps %s to the machine kind',
    (code) => {
      expect(classifySwitchError({ data: { code } }).kind).toBe('machine');
    }
  );

  it('maps a plain Error to the generic fallback', () => {
    expect(classifySwitchError(new Error('boom'))).toEqual({
      kind: 'generic',
      message: 'Could not switch the workspace. Try again.',
    });
  });
});

describe('SKIP_REASON_COPY', () => {
  it('has the three reason strings', () => {
    expect(SKIP_REASON_COPY).toEqual({
      harness_unavailable: 'Harness not available on the new machine',
      target_has_config: 'The new workspace already has a configuration for this role',
      not_remote: 'Not a remote agent, so nothing to carry over',
    });
  });
});

describe('stopSummaryLine', () => {
  it('reports a queued stop request', () => {
    expect(stopSummaryLine(true)).toBe('Stop requested for agents on the previous workspace.');
  });

  it('reports that no agents were running', () => {
    expect(stopSummaryLine(false)).toBe('No agents were running on the previous workspace.');
  });
});

describe('isSameWorkspace', () => {
  it('ignores a trailing slash', () => {
    expect(
      isSameWorkspace(
        { machineId: 'm1', workingDir: '/code/app/' },
        { machineId: 'm1', workingDir: '/code/app' }
      )
    ).toBe(true);
  });

  it('is false for a different machine', () => {
    expect(
      isSameWorkspace(
        { machineId: 'm1', workingDir: '/code/app' },
        { machineId: 'm2', workingDir: '/code/app' }
      )
    ).toBe(false);
  });

  it('is false for a different folder', () => {
    expect(
      isSameWorkspace(
        { machineId: 'm1', workingDir: '/code/app' },
        { machineId: 'm1', workingDir: '/code/other' }
      )
    ).toBe(false);
  });
});

describe('normalizeWorkingDir', () => {
  it('keeps a lone slash', () => {
    expect(normalizeWorkingDir('/')).toBe('/');
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeWorkingDir('  /code/app//  ')).toBe('/code/app');
  });
});
