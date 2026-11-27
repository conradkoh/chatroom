import { describe, expect, it } from 'vitest';

import {
  isInfoLine,
  isOpencodeConsoleConfigProbeWarning,
  parseModelId,
  parseOpencodeSpawnModel,
} from './pure.js';
import { TEST_MODEL_OPENCODE } from '../../../../../../testing/test-models.js';

describe('parseModelId', () => {
  it('parses single-slash model id', () => {
    expect(parseModelId(TEST_MODEL_OPENCODE)).toEqual({
      providerID: 'opencode',
      modelID: 'big-pickle',
    });
  });

  it('splits on first slash only, preserving trailing path in modelID', () => {
    expect(parseModelId(`${TEST_MODEL_OPENCODE}/thinking`)).toEqual({
      providerID: 'opencode',
      modelID: 'big-pickle/thinking',
    });
  });

  it('returns undefined for model without slash', () => {
    expect(parseModelId('no-slash-here')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseModelId('')).toBeUndefined();
  });

  it('returns undefined for leading slash', () => {
    expect(parseModelId('/foo')).toBeUndefined();
  });

  it('returns undefined for trailing slash', () => {
    expect(parseModelId('foo/')).toBeUndefined();
  });
});

describe('parseOpencodeSpawnModel', () => {
  it('extracts variant from bracket model string', () => {
    expect(parseOpencodeSpawnModel('opencode-go/gpt-5.6-luna[variant=max]')).toEqual({
      model: 'opencode-go/gpt-5.6-luna',
      variant: 'max',
    });
  });

  it('passes through plain model', () => {
    expect(parseOpencodeSpawnModel('opencode-go/gpt-5.6-luna')).toEqual({
      model: 'opencode-go/gpt-5.6-luna',
    });
  });
});

describe('isInfoLine', () => {
  it('returns true for INFO-prefixed line', () => {
    expect(isInfoLine('INFO foo')).toBe(true);
  });

  it('returns true for INFO with multiple spaces', () => {
    expect(isInfoLine('INFO  foo')).toBe(true);
  });

  it('returns true for INFO with leading whitespace', () => {
    expect(isInfoLine('  INFO foo')).toBe(true);
  });

  it('returns false for INFO without trailing space', () => {
    expect(isInfoLine('INFO')).toBe(false);
  });

  it('returns false for INF (no trailing space)', () => {
    expect(isInfoLine('INFOR foo')).toBe(false);
  });

  it('returns false for WARN-prefixed line', () => {
    expect(isInfoLine('WARN foo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isInfoLine('')).toBe(false);
  });

  it('returns false for agent output with timestamp in brackets', () => {
    expect(
      isInfoLine('[2026-07-11T08:20:24.355Z] role:planner thinking] Let me see the actual types:')
    ).toBe(false);
  });

  it('returns false for structured level=INFO line (suppressed via --log-level warn at spawn)', () => {
    expect(
      isInfoLine(
        'timestamp=2026-07-11T08:20:28.536Z level=INFO run=c792c273 message="llm runtime selected"'
      )
    ).toBe(false);
  });
});

describe('isOpencodeConsoleConfigProbeWarning', () => {
  const PROBE_WARNING =
    'failed to load OpenCode provider config cause="HttpClientError: StatusCode: non 2xx status code (401 GET https://opencode.ai/console/api/v2/config)"';

  it('matches the known config-probe warning', () => {
    expect(isOpencodeConsoleConfigProbeWarning(`WARN  ${PROBE_WARNING}`)).toBe(true);
  });

  it('matches the logfmt form of the same warning', () => {
    expect(
      isOpencodeConsoleConfigProbeWarning(
        'timestamp=2026-11-04T19:42:41.391Z level=WARN run=53b3ff14 message="failed to load OpenCode provider config" cause="HttpClientError: StatusCode: non 2xx status code (401 GET https://opencode.ai/console/api/v2/config)"'
      )
    ).toBe(true);
  });

  it('does not match a different provider warning', () => {
    expect(
      isOpencodeConsoleConfigProbeWarning(
        'WARN  2026-11-04T19:42:41 service=provider failed to load model opencode-go/gpt-5.6-luna'
      )
    ).toBe(false);
  });

  it('does not match the same message against a different endpoint', () => {
    expect(
      isOpencodeConsoleConfigProbeWarning(
        'WARN  failed to load OpenCode provider config cause="HttpClientError: StatusCode: non 2xx status code (500 GET https://example.test/config)"'
      )
    ).toBe(false);
  });

  it('does not match an ordinary WARN line', () => {
    expect(
      isOpencodeConsoleConfigProbeWarning(
        'WARN  2026-11-04T19:42:41 service=foo something interesting'
      )
    ).toBe(false);
  });
});
