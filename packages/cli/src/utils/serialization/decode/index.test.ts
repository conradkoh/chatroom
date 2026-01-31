/**
 * Tests for CLI input decoder
 */

import { describe, it, expect } from 'vitest';

import { decode, detectDelimiterCollisions, formatDecodeError } from './index.js';

describe('decode', () => {
  describe('single parameter mode', () => {
    it('should decode entire input as single parameter', () => {
      const input = `## Summary
This is a test message
with multiple lines

and empty lines too`;

      const result = decode(input, { singleParam: 'message' });

      expect(result).toEqual({
        message: `## Summary
This is a test message
with multiple lines

and empty lines too`,
      });
    });

    it('should trim leading/trailing whitespace', () => {
      const input = `\n\n  Content here  \n\n`;
      const result = decode(input, { singleParam: 'message' });
      expect(result.message).toBe('Content here');
    });

    it('should preserve internal whitespace', () => {
      const input = `Line 1\n  Indented\n\nLine after blank`;
      const result = decode(input, { singleParam: 'message' });
      expect(result.message).toBe('Line 1\n  Indented\n\nLine after blank');
    });
  });

  describe('multi parameter mode', () => {
    it('should decode multiple parameters', () => {
      const input = `---TITLE---
User Authentication
---DESCRIPTION---
Add login and logout functionality
---TECH_SPECS---
- Use JWT tokens
- Bcrypt for passwords`;

      const result = decode(input, {
        expectedParams: ['TITLE', 'DESCRIPTION', 'TECH_SPECS'],
      });

      expect(result).toEqual({
        TITLE: 'User Authentication',
        DESCRIPTION: 'Add login and logout functionality',
        TECH_SPECS: '- Use JWT tokens\n- Bcrypt for passwords',
      });
    });

    it('should handle parameters with blank lines in content', () => {
      const input = `---DESCRIPTION---
First paragraph

Second paragraph with gap

Third paragraph`;

      const result = decode(input);

      expect(result.DESCRIPTION).toBe(
        'First paragraph\n\nSecond paragraph with gap\n\nThird paragraph'
      );
    });

    it('should skip empty lines before first delimiter', () => {
      const input = `

---TITLE---
Test Title`;

      const result = decode(input);
      expect(result).toEqual({ TITLE: 'Test Title' });
    });

    it('should error on unknown parameter', () => {
      const input = `---UNKNOWN---
Content`;

      expect(() => {
        decode(input, { expectedParams: ['TITLE'] });
      }).toThrow(/Unknown parameter 'UNKNOWN'/);
    });

    it('should error on missing required parameter', () => {
      const input = `---DESCRIPTION---
Only description`;

      expect(() => {
        decode(input, {
          expectedParams: ['TITLE', 'DESCRIPTION'],
          requiredParams: ['TITLE'],
        });
      }).toThrow(/Required parameter 'TITLE' is missing/);
    });

    it('should error on duplicate parameter', () => {
      const input = `---TITLE---
First title
---TITLE---
Second title`;

      expect(() => {
        decode(input);
      }).toThrow(/Duplicate parameter 'TITLE'/);
    });

    it('should error on content before first delimiter', () => {
      const input = `Some content without delimiter
---TITLE---
Title here`;

      expect(() => {
        decode(input);
      }).toThrow(/Content found before first parameter delimiter/);
    });

    it('should error on empty parameter', () => {
      const input = `---TITLE---

---DESCRIPTION---
Valid content`;

      expect(() => {
        decode(input);
      }).toThrow(/Parameter 'TITLE' is empty/);
    });

    it('should preserve indentation in code blocks', () => {
      const input = `---TECH_SPECS---
Implementation notes:
  - Step 1
    - Sub-step A
    - Sub-step B
  - Step 2`;

      const result = decode(input);
      expect(result.TECH_SPECS).toBe(
        'Implementation notes:\n  - Step 1\n    - Sub-step A\n    - Sub-step B\n  - Step 2'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle delimiter-like content in single param mode', () => {
      const input = `The old code had:
---TITLE---
Which looked like a delimiter`;

      const result = decode(input, { singleParam: 'message' });
      expect(result.message).toContain('---TITLE---');
    });

    it('should only match delimiter on its own line', () => {
      const input = `---TITLE---
Content with ---TITLE--- inline should work
---DESCRIPTION---
More content`;

      const result = decode(input);
      expect(result.TITLE).toBe('Content with ---TITLE--- inline should work');
      expect(result.DESCRIPTION).toBe('More content');
    });

    it('should handle delimiter with surrounding spaces (not a delimiter)', () => {
      const input = `---TITLE---
Content with  ---TITLE---  spaces
---DESCRIPTION---
More`;

      const result = decode(input);
      expect(result.TITLE).toContain('---TITLE---');
    });
  });
});

describe('detectDelimiterCollisions', () => {
  it('should detect delimiter collision', () => {
    const content = `The code had this pattern:
---TITLE---
Which caused issues`;

    const collisions = detectDelimiterCollisions(content, ['TITLE', 'DESCRIPTION']);
    expect(collisions).toEqual(['---TITLE---']);
  });

  it('should not detect inline delimiter as collision', () => {
    const content = `The pattern ---TITLE--- appeared inline`;
    const collisions = detectDelimiterCollisions(content, ['TITLE']);
    expect(collisions).toEqual([]);
  });

  it('should detect multiple collisions', () => {
    const content = `Pattern 1:
---TITLE---
Pattern 2:
---DESCRIPTION---
Both are problems`;

    const collisions = detectDelimiterCollisions(content, ['TITLE', 'DESCRIPTION']);
    expect(collisions).toEqual(['---TITLE---', '---DESCRIPTION---']);
  });

  it('should return empty array when no collisions', () => {
    const content = `Normal content here\nNo delimiters present`;
    const collisions = detectDelimiterCollisions(content, ['TITLE']);
    expect(collisions).toEqual([]);
  });
});

describe('formatDecodeError', () => {
  it('should format unknown param error', () => {
    const error = {
      code: 'UNKNOWN_PARAM' as const,
      message: "Unknown parameter 'INVALID'",
      line: 5,
      paramName: 'INVALID',
    };

    const formatted = formatDecodeError(error);
    expect(formatted).toContain('❌');
    expect(formatted).toContain('Line: 5');
  });

  it('should format collision error with workaround', () => {
    const error = {
      code: 'COLLISION' as const,
      message: 'Content contains delimiter',
    };

    const formatted = formatDecodeError(error);
    expect(formatted).toContain('💡 Workaround');
    expect(formatted).toContain('Rephrase');
  });

  it('should format invalid format error with example', () => {
    const error = {
      code: 'INVALID_FORMAT' as const,
      message: 'Content before delimiter',
      line: 2,
    };

    const formatted = formatDecodeError(error);
    expect(formatted).toContain('💡 Expected format');
    expect(formatted).toContain('---PARAM_NAME---');
  });
});
