/**
 * Package name tests.
 *
 * The rendered base becomes a file name, so the cases here are the ones that
 * would otherwise write outside the package directory or leave braces in a path.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NAME_TEMPLATE,
  formatTimestamp,
  renderPackageName,
  templateNeedsRequestId,
} from './package-name.js';

const VARS = {
  stem: 'chest',
  model: 'meshy/v7.1/text-to-3d',
  timestamp: '20261028-011838',
  requestId8: '01a18014',
} as const;

describe('formatTimestamp', () => {
  it('formats a UTC timestamp as YYYYMMDD-HHmmss', () => {
    expect(formatTimestamp(new Date('2026-10-28T01:18:38.905Z'))).toBe('20261028-011838');
  });

  it('pads single-digit months, days, hours, minutes, and seconds', () => {
    expect(formatTimestamp(new Date('2026-01-02T03:04:05.000Z'))).toBe('20260102-030405');
  });

  it('uses UTC rather than the host timezone', () => {
    // 2026-12-31T23:30:00Z is 2027-01-01 in timezones at or past UTC+1.
    expect(formatTimestamp(new Date('2026-12-31T23:30:00.000Z'))).toBe('20261231-233000');
  });
});

describe('renderPackageName', () => {
  it('renders the default template as stem plus timestamp', () => {
    expect(renderPackageName(DEFAULT_NAME_TEMPLATE, VARS)).toBe('chest-20261028-011838');
  });

  it('renders a custom template with every placeholder', () => {
    expect(renderPackageName('{model}_{stem}-{requestId8}-{timestamp}', VARS)).toBe(
      'meshy-v7.1-text-to-3d_chest-01a18014-20261028-011838'
    );
  });

  it('replaces every slash in the model id', () => {
    expect(renderPackageName('{model}', VARS)).toBe('meshy-v7.1-text-to-3d');
  });

  it('rejects an unknown placeholder and names it', () => {
    expect(() => renderPackageName('{stem}-{version}', VARS)).toThrow(
      /Unknown --name placeholder "\{version\}"/
    );
  });

  it('rejects an unclosed brace', () => {
    expect(() => renderPackageName('{stem}-{', VARS)).toThrow(/Unclosed brace/);
  });

  it('rejects a rendered path separator', () => {
    expect(() => renderPackageName('nested/{stem}', VARS)).toThrow(/path separator/);
  });

  it('rejects a rendered parent-directory segment', () => {
    expect(() => renderPackageName('a..{stem}', VARS)).toThrow(/would leave the package directory/);
  });

  it('rejects an empty rendered name', () => {
    expect(() => renderPackageName('', VARS)).toThrow(/not a valid file name/);
  });

  it('rejects a name that does not start with a letter or digit', () => {
    expect(() => renderPackageName('-{stem}', VARS)).toThrow(/not a valid file name/);
  });

  it('requires the request id to render {requestId8}', () => {
    expect(() =>
      renderPackageName('{stem}-{requestId8}', { ...VARS, requestId8: undefined })
    ).toThrow(/only known after the fal call/);
  });
});

describe('templateNeedsRequestId', () => {
  it('is true only when the template uses the request id', () => {
    expect(templateNeedsRequestId(DEFAULT_NAME_TEMPLATE)).toBe(false);
    expect(templateNeedsRequestId('{stem}-{requestId8}')).toBe(true);
  });
});
