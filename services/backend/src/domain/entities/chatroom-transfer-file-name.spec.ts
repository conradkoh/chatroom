/**
 * Transfer file names — the single source shared by the CLI and the browser.
 *
 * The literals pin the Windows-safe bundle name; the date is fixed so the assertion never
 * depends on the machine's clock or timezone.
 */

import { describe, expect, it } from 'vitest';

import { bundleFileName, transferTimestamp } from './chatroom-transfer-file-name';

const AT = new Date('2026-03-01T14:15:02Z');

describe('transferTimestamp', () => {
  it('formats UTC as YYYYMMDDTHHMMSSZ without colons', () => {
    expect(transferTimestamp(AT)).toBe('20260301T141502Z');
  });

  it('drops the milliseconds', () => {
    expect(transferTimestamp(new Date('2026-03-01T14:15:02.999Z'))).toBe('20260301T141502Z');
  });
});

describe('bundleFileName', () => {
  it('names the one-file bundle', () => {
    expect(bundleFileName('m1', AT)).toBe('chatroom-all-m1-20260301T141502Z.json');
  });

  it('replaces characters outside [A-Za-z0-9_-] with "_"', () => {
    expect(bundleFileName('a b/c', AT)).toBe('chatroom-all-a_b_c-20260301T141502Z.json');
  });
});
