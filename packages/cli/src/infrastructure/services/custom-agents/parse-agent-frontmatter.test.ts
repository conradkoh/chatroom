import { CUSTOM_AGENT_FORBIDDEN_FRONTMATTER_KEYS } from '@workspace/shared/domain/custom-agent';
import { describe, expect, it } from 'vitest';

import { parseAgentFile } from './parse-agent-frontmatter.js';

/** Alternates case so the key differs textually but matches case-insensitively. */
function mixedCase(key: string): string {
  return [...key]
    .map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char.toLowerCase()))
    .join('');
}

function fileWith(frontmatter: string, body = 'You are alpha.'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe('parseAgentFile', () => {
  it('parses name, description, and a trimmed body', () => {
    const result = parseAgentFile(
      fileWith('name: alpha\ndescription: Alpha role.', '\n\nYou are alpha.\n\n')
    );

    expect(result).toEqual({
      ok: true,
      name: 'alpha',
      description: 'Alpha role.',
      body: 'You are alpha.',
      flaggedKeys: [],
    });
  });

  it('allows an empty body', () => {
    const result = parseAgentFile(fileWith('name: alpha\ndescription: Alpha role.', ''));

    expect(result).toEqual({
      ok: true,
      name: 'alpha',
      description: 'Alpha role.',
      body: '',
      flaggedKeys: [],
    });
  });

  it('rejects an empty file as missing frontmatter', () => {
    expect(parseAgentFile('')).toEqual({ ok: false, reason: 'missing-frontmatter' });
  });

  it('requires the opening delimiter to be exactly three dashes', () => {
    const result = parseAgentFile('--- \nname: alpha\ndescription: Alpha role.\n---\nBody.');

    expect(result).toEqual({ ok: false, reason: 'missing-frontmatter' });
  });

  it('requires a closing delimiter', () => {
    const result = parseAgentFile('---\nname: alpha\ndescription: Alpha role.\n');

    expect(result).toEqual({ ok: false, reason: 'missing-frontmatter' });
  });

  it('requires the closing delimiter to be exactly three dashes', () => {
    const result = parseAgentFile('---\nname: alpha\ndescription: Alpha role.\n--- \nBody.');

    expect(result).toEqual({ ok: false, reason: 'missing-frontmatter' });
  });

  it('rejects duplicate keys', () => {
    const result = parseAgentFile(fileWith('name: alpha\nname: beta\ndescription: Alpha role.'));

    expect(result).toEqual({ ok: false, reason: 'invalid-frontmatter' });
  });

  it('rejects a non-mapping root', () => {
    expect(parseAgentFile('---\n- alpha\n- beta\n---\nBody.')).toEqual({
      ok: false,
      reason: 'invalid-frontmatter',
    });
  });

  it('rejects an anchor', () => {
    const result = parseAgentFile(fileWith('name: &primary alpha\ndescription: Alpha role.'));

    expect(result).toEqual({ ok: false, reason: 'invalid-frontmatter' });
  });

  it('rejects an alias', () => {
    const result = parseAgentFile(fileWith('name: &primary alpha\ndescription: *primary'));

    expect(result).toEqual({ ok: false, reason: 'invalid-frontmatter' });
  });

  it('rejects a custom tag', () => {
    const result = parseAgentFile(fileWith('name: !custom alpha\ndescription: Alpha role.'));

    expect(result).toEqual({ ok: false, reason: 'invalid-frontmatter' });
  });

  it('rejects a non-string value', () => {
    const result = parseAgentFile(fileWith('name: alpha\ndescription: 42'));

    expect(result).toEqual({ ok: false, reason: 'invalid-frontmatter' });
  });

  it('rejects missing required keys', () => {
    expect(parseAgentFile(fileWith('name: alpha'))).toEqual({
      ok: false,
      reason: 'invalid-frontmatter',
    });
  });

  it('flags an unknown key without rejecting the agent', () => {
    const result = parseAgentFile(fileWith('name: alpha\ndescription: Alpha role.\nnotes: hello'));

    expect(result).toEqual({
      ok: true,
      name: 'alpha',
      description: 'Alpha role.',
      body: 'You are alpha.',
      flaggedKeys: [{ key: 'notes', reason: 'unknown-field' }],
    });
  });

  it.each(CUSTOM_AGENT_FORBIDDEN_FRONTMATTER_KEYS)(
    'flags forbidden key %s in mixed case',
    (forbiddenKey) => {
      const written = mixedCase(forbiddenKey);
      const result = parseAgentFile(
        fileWith(`name: alpha\ndescription: Alpha role.\n${written}: value`)
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.flaggedKeys).toEqual([{ key: written, reason: 'forbidden-field' }]);
      expect(result.name).toBe('alpha');
    }
  );

  it('parses a 10 MB input without hanging', () => {
    const body = 'x'.repeat(10 * 1024 * 1024);
    const result = parseAgentFile(fileWith('name: alpha\ndescription: Alpha role.', body));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toHaveLength(body.length);
  });

  it('parses thousands of unknown keys without rejecting the file', () => {
    const keys = Array.from({ length: 5_000 }, (_, index) => `extra-${index}: value-${index}`);
    const result = parseAgentFile(
      fileWith(`name: alpha\ndescription: Alpha role.\n${keys.join('\n')}`)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flaggedKeys).toHaveLength(5_000);
    expect(result.flaggedKeys.every(({ reason }) => reason === 'unknown-field')).toBe(true);
  });

  it('does not treat a later document separator as frontmatter', () => {
    const result = parseAgentFile(
      fileWith('name: alpha\ndescription: Alpha role.', 'Body.\n---\nMore body.')
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe('Body.\n---\nMore body.');
  });
});
