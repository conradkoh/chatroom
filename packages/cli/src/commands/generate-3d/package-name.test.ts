/**
 * Package base name tests.
 *
 * The base becomes two file names, so the cases here are the ones that would
 * otherwise write nothing, write outside the package directory, or leave an
 * unusable `--out` unexplained.
 */

import { describe, expect, it } from 'vitest';

import { formatTimestamp, packageBaseName } from './package-name.js';

const TIMESTAMP = '20261028-011838';

/** Render a stem the way the command does, with a fixed timestamp. */
function base(stem: string): string {
  return packageBaseName({ stem, timestamp: TIMESTAMP });
}

describe('formatTimestamp', () => {
  it('formats a UTC timestamp as YYYYMMDD-HHmmss', () => {
    expect(formatTimestamp(new Date('2026-10-28T01:18:38.905Z'))).toBe(TIMESTAMP);
  });

  it('pads single-digit months, days, hours, minutes, and seconds', () => {
    expect(formatTimestamp(new Date('2026-01-02T03:04:05.000Z'))).toBe('20260102-030405');
  });

  it('uses UTC rather than the host timezone', () => {
    // 2026-12-31T23:30:00Z is 2027-01-01 in timezones at or past UTC+1.
    expect(formatTimestamp(new Date('2026-12-31T23:30:00.000Z'))).toBe('20261231-233000');
  });
});

describe('packageBaseName', () => {
  it('joins a plain stem and the timestamp', () => {
    expect(base('chest')).toBe(`chest-${TIMESTAMP}`);
  });

  it.each([
    ['My Chest', 'My-Chest'],
    ['chest (1)', 'chest-1-'],
    ['_tmp', 'tmp'],
    ['.hidden', 'hidden'],
    ['--flag', 'flag'],
    ['knight final', 'knight-final'],
    ['a/b', 'a-b'],
  ])('sanitizes a %s stem into a valid base', (stem, expected) => {
    const rendered = base(stem);

    expect(rendered).toBe(`${expected}-${TIMESTAMP}`);
    expect(rendered).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  it.each([['宝箱'], ['***'], ['']])(
    'rejects the unusable --out stem %s and names --out',
    (stem) => {
      expect(() => base(stem)).toThrow(
        /output file name .*cannot form a package name.*Rename --out/s
      );
    }
  );
});
