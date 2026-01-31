/**
 * Unit tests for STDIN Decoder
 *
 * Tests cover:
 * - Single message decoding (markdown format)
 * - Structured parameter decoding (text format with ---PARAM--- delimiters)
 * - Error handling for malformed input
 */

import { describe, expect, test } from 'vitest';

import {
  decode,
  decodeMessage,
  decodeStructured,
  type DecodeError,
  detectDelimiterCollisions,
  formatDecodeError,
} from '../../../convex/lib/stdinDecoder';

describe('decodeMessage', () => {
  test('decodes simple message', () => {
    const input = 'Hello world';
    expect(decodeMessage(input)).toBe('Hello world');
  });

  test('trims whitespace', () => {
    const input = '  \n  Hello world  \n  ';
    expect(decodeMessage(input)).toBe('Hello world');
  });

  test('preserves markdown formatting', () => {
    const input = `# Summary

Implemented feature X

## Changes
- Added new component
- Updated tests`;
    expect(decodeMessage(input)).toBe(input);
  });

  test('handles empty input', () => {
    expect(decodeMessage('')).toBe('');
    expect(decodeMessage('   \n   ')).toBe('');
  });
});

describe('decodeStructured', () => {
  test('decodes all required parameters', () => {
    const input = `---TITLE---
Feature X

---DESCRIPTION---
Adds functionality for X

---TECH_SPECS---
Uses TypeScript and React`;

    const result = decodeStructured(input, ['TITLE', 'DESCRIPTION', 'TECH_SPECS']);

    expect(result).toEqual({
      TITLE: 'Feature X',
      DESCRIPTION: 'Adds functionality for X',
      TECH_SPECS: 'Uses TypeScript and React',
    });
  });

  test('throws on missing required parameter', () => {
    const input = `---TITLE---
Feature X

---DESCRIPTION---
Adds functionality for X`;

    expect(() => {
      decodeStructured(input, ['TITLE', 'DESCRIPTION', 'TECH_SPECS']);
    }).toThrow("Required parameter 'TECH_SPECS' is missing");
  });

  test('throws on unknown parameter', () => {
    const input = `---TITLE---
Feature X

---UNKNOWN---
Content`;

    expect(() => {
      decodeStructured(input, ['TITLE', 'DESCRIPTION']);
    }).toThrow("Unknown parameter 'UNKNOWN'");
  });

  test('throws on duplicate parameter', () => {
    const input = `---TITLE---
First

---TITLE---
Second`;

    expect(() => {
      decodeStructured(input, ['TITLE']);
    }).toThrow("Duplicate parameter 'TITLE'");
  });

  test('throws on empty parameter content', () => {
    const input = `---TITLE---

---DESCRIPTION---
Some content`;

    expect(() => {
      decodeStructured(input, ['TITLE', 'DESCRIPTION']);
    }).toThrow("Parameter 'TITLE' is empty");
  });

  test('preserves internal formatting', () => {
    const input = `---DESCRIPTION---
Line 1

Line 3 with gap

  Indented line`;

    const result = decodeStructured(input, ['DESCRIPTION']);

    expect(result.DESCRIPTION).toBe(`Line 1

Line 3 with gap

  Indented line`);
  });
});

describe('decode - single parameter mode', () => {
  test('treats entire input as single parameter', () => {
    const input = 'This is a message';
    const result = decode(input, { singleParam: 'message' });

    expect(result).toEqual({ message: 'This is a message' });
  });

  test('ignores delimiters in single parameter mode', () => {
    const input = `---TITLE---
Not a delimiter, just content`;

    const result = decode(input, { singleParam: 'message' });

    expect(result).toEqual({
      message: `---TITLE---
Not a delimiter, just content`,
    });
  });
});

describe('decode - multi parameter mode', () => {
  test('decodes expected parameters', () => {
    const input = `---ALPHA---
First

---BETA---
Second`;

    const result = decode(input, {
      expectedParams: ['ALPHA', 'BETA'],
    });

    expect(result).toEqual({
      ALPHA: 'First',
      BETA: 'Second',
    });
  });

  test('validates required parameters', () => {
    const input = `---ALPHA---
First`;

    expect(() => {
      decode(input, {
        expectedParams: ['ALPHA', 'BETA'],
        requiredParams: ['ALPHA', 'BETA'],
      });
    }).toThrow("Required parameter 'BETA' is missing");
  });

  test('skips empty lines before first delimiter', () => {
    const input = `

---TITLE---
Content`;

    const result = decode(input, {
      expectedParams: ['TITLE'],
    });

    expect(result).toEqual({ TITLE: 'Content' });
  });

  test('throws on content before first delimiter', () => {
    const input = `Random content
---TITLE---
Content`;

    expect(() => {
      decode(input, { expectedParams: ['TITLE'] });
    }).toThrow('Content found before first parameter delimiter');
  });
});

describe('detectDelimiterCollisions', () => {
  test('detects delimiter patterns in content', () => {
    const content = `Some text
---TITLE---
More text`;

    const collisions = detectDelimiterCollisions(content, ['TITLE', 'DESCRIPTION']);

    expect(collisions).toEqual(['---TITLE---']);
  });

  test('returns empty array when no collisions', () => {
    const content = 'Just regular content without delimiters';

    const collisions = detectDelimiterCollisions(content, ['TITLE']);

    expect(collisions).toEqual([]);
  });

  test('ignores delimiter patterns with extra whitespace', () => {
    const content = ' ---TITLE---  ';

    const collisions = detectDelimiterCollisions(content, ['TITLE']);

    // Should still detect it (after trim)
    expect(collisions).toEqual(['---TITLE---']);
  });
});

describe('formatDecodeError', () => {
  test('formats basic error', () => {
    const error: DecodeError = {
      code: 'MISSING_PARAM',
      message: 'Parameter TITLE is missing',
    };

    const formatted = formatDecodeError(error);

    expect(formatted).toContain('❌ Parameter TITLE is missing');
  });

  test('includes line number if present', () => {
    const error: DecodeError = {
      code: 'INVALID_FORMAT',
      message: 'Invalid format',
      line: 42,
    };

    const formatted = formatDecodeError(error);

    expect(formatted).toContain('Line: 42');
  });

  test('adds workaround for collision errors', () => {
    const error: DecodeError = {
      code: 'COLLISION',
      message: 'Delimiter collision detected',
    };

    const formatted = formatDecodeError(error);

    expect(formatted).toContain('💡 Workaround');
    expect(formatted).toContain('Rephrase');
  });

  test('adds format guide for invalid format errors', () => {
    const error: DecodeError = {
      code: 'INVALID_FORMAT',
      message: 'Invalid format',
    };

    const formatted = formatDecodeError(error);

    expect(formatted).toContain('💡 Expected format');
    expect(formatted).toContain('---PARAM_NAME---');
  });
});
