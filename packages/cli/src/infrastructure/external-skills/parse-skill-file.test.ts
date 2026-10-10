/**
 * parseSkillFile — pure SKILL.md frontmatter parser tests.
 */
import { describe, expect, test } from 'vitest';

import { parseSkillFile } from './parse-skill-file.js';

function skill(frontmatter: string, body = '# Body\n'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe('parseSkillFile', () => {
  test('valid plain frontmatter returns name, description, and body', () => {
    const result = parseSkillFile(
      skill('name: my-skill\ndescription: Does things', '# Title\n\nText\n')
    );
    expect(result).toEqual({
      ok: true,
      name: 'my-skill',
      description: 'Does things',
      body: '# Title\n\nText\n',
    });
  });

  test('quoted name parses', () => {
    const result = parseSkillFile(skill('name: "my-skill"\ndescription: "Quoted desc"'));
    expect(result).toMatchObject({ ok: true, name: 'my-skill', description: 'Quoted desc' });
  });

  test('nested metadata map is ignored and does not fail', () => {
    const result = parseSkillFile(
      skill('name: my-skill\ndescription: d\nmetadata:\n  author: someone\n  version: "1"')
    );
    expect(result).toMatchObject({ ok: true, name: 'my-skill', description: 'd' });
  });

  test('hidden: true is ignored and the result is ok', () => {
    const result = parseSkillFile(skill('name: my-skill\ndescription: d\nhidden: true'));
    expect(result.ok).toBe(true);
  });

  test('CRLF line endings and a leading BOM both parse', () => {
    const content = '﻿---\r\nname: my-skill\r\ndescription: d\r\n---\r\nline one\r\nline two\r\n';
    const result = parseSkillFile(content);
    expect(result).toEqual({
      ok: true,
      name: 'my-skill',
      description: 'd',
      body: 'line one\nline two\n',
    });
  });

  test('missing opening --- returns missing-frontmatter', () => {
    const result = parseSkillFile('name: my-skill\ndescription: d\n---\n# Body\n');
    expect(result).toEqual({ ok: false, reason: 'missing-frontmatter' });
  });

  test('unclosed frontmatter returns missing-frontmatter', () => {
    const result = parseSkillFile('---\nname: my-skill\ndescription: d\n# Body\n');
    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-frontmatter',
      detail: 'unclosed frontmatter',
    });
  });

  test('invalid YAML returns invalid-frontmatter', () => {
    const result = parseSkillFile('---\nname: [\ndescription: d\n---\n');
    expect(result).toMatchObject({ ok: false, reason: 'invalid-frontmatter' });
  });

  test('top-level array returns invalid-frontmatter', () => {
    const result = parseSkillFile('---\n- a\n- b\n---\n');
    expect(result).toMatchObject({ ok: false, reason: 'invalid-frontmatter' });
  });

  test('uppercase name returns invalid-name', () => {
    const result = parseSkillFile(skill('name: Foo\ndescription: d'));
    expect(result).toEqual({ ok: false, reason: 'invalid-name' });
  });

  test('65-character name returns invalid-name', () => {
    const result = parseSkillFile(skill(`name: ${'a'.repeat(65)}\ndescription: d`));
    expect(result).toEqual({ ok: false, reason: 'invalid-name' });
  });

  test('missing description returns invalid-description', () => {
    const result = parseSkillFile(skill('name: my-skill'));
    expect(result).toEqual({ ok: false, reason: 'invalid-description' });
  });

  test('empty or whitespace-only description returns invalid-description', () => {
    expect(parseSkillFile(skill("name: my-skill\ndescription: ''"))).toEqual({
      ok: false,
      reason: 'invalid-description',
    });
    expect(parseSkillFile(skill("name: my-skill\ndescription: '   '"))).toEqual({
      ok: false,
      reason: 'invalid-description',
    });
  });

  test('description of 1025 characters returns invalid-description', () => {
    const result = parseSkillFile(skill(`name: my-skill\ndescription: "${'d'.repeat(1025)}"`));
    expect(result).toEqual({ ok: false, reason: 'invalid-description' });
  });

  test('description of exactly 1024 characters is accepted', () => {
    const description = 'd'.repeat(1024);
    const result = parseSkillFile(skill(`name: my-skill\ndescription: "${description}"`));
    expect(result).toMatchObject({ ok: true, description });
  });

  test('leading blank lines in body are trimmed while internal blank lines are preserved', () => {
    const content =
      '---\nname: my-skill\ndescription: d\n---\n\n\n# Title\n\nline one\n\n\nline two\n';
    const result = parseSkillFile(content);
    expect(result).toMatchObject({ ok: true, body: '# Title\n\nline one\n\n\nline two\n' });
  });

  test('description containing a colon parses', () => {
    const result = parseSkillFile(
      skill('name: my-skill\ndescription: "Use when: browsing the web"')
    );
    expect(result).toMatchObject({ ok: true, description: 'Use when: browsing the web' });
  });
});

describe('parseSkillFile never throws', () => {
  test('empty input returns missing-frontmatter', () => {
    expect(parseSkillFile('')).toEqual({ ok: false, reason: 'missing-frontmatter' });
  });
});
