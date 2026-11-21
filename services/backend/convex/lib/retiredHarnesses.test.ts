import { describe, expect, test } from 'vitest';

import {
  RETIRED_CLI_HARNESSES,
  isRetiredCliHarness,
  withoutRetiredHarnessNames,
  withoutRetiredHarnesses,
} from './retiredHarnesses';

describe('isRetiredCliHarness', () => {
  test.each(['opencode', 'pi', 'cursor', 'claude', 'copilot', 'commandcode'])(
    'treats %s as retired',
    (name) => {
      expect(isRetiredCliHarness(name)).toBe(true);
    }
  );

  test.each(['opencode-sdk', 'pi-sdk', 'cursor-sdk', 'claude-sdk', 'codex-sdk'])(
    'does not treat SDK harness %s as retired',
    (name) => {
      expect(isRetiredCliHarness(name)).toBe(false);
    }
  );

  test.each([undefined, null, 42, {}, ['opencode'], true])(
    'treats non-string %p as not retired',
    (value) => {
      expect(isRetiredCliHarness(value)).toBe(false);
    }
  );

  test('matches exactly and case-sensitively', () => {
    expect(isRetiredCliHarness('OPENCODE')).toBe(false);
    expect(isRetiredCliHarness('')).toBe(false);
  });

  test('the constant lists exactly the six retired names', () => {
    expect([...RETIRED_CLI_HARNESSES].sort()).toEqual(
      ['claude', 'commandcode', 'copilot', 'cursor', 'opencode', 'pi'].sort()
    );
  });
});

describe('withoutRetiredHarnesses', () => {
  test('drops retired rows, keeps SDK rows in order', () => {
    const rows = [
      { agentHarness: 'opencode', model: 'a' },
      { agentHarness: 'claude-sdk', model: 'b' },
      { agentHarness: 'pi', model: 'c' },
      { agentHarness: 'codex-sdk', model: 'd' },
    ];
    expect(withoutRetiredHarnesses(rows)).toEqual([
      { agentHarness: 'claude-sdk', model: 'b' },
      { agentHarness: 'codex-sdk', model: 'd' },
    ]);
  });

  test('is idempotent', () => {
    const rows = [{ agentHarness: 'cursor' }, { agentHarness: 'opencode-sdk' }];
    const once = withoutRetiredHarnesses(rows);
    expect(withoutRetiredHarnesses(once)).toEqual(once);
  });

  test('returns an empty array when every row is retired', () => {
    expect(withoutRetiredHarnesses([{ agentHarness: 'copilot' }])).toEqual([]);
  });
});

describe('withoutRetiredHarnessNames', () => {
  test('drops retired names and keeps SDK names in order', () => {
    expect(withoutRetiredHarnessNames(['opencode', 'claude-sdk', 'copilot', 'codex-sdk'])).toEqual([
      'claude-sdk',
      'codex-sdk',
    ]);
  });

  test('is idempotent', () => {
    const once = withoutRetiredHarnessNames(['pi', 'cursor-sdk']);
    expect(withoutRetiredHarnessNames(once)).toEqual(once);
  });
});
