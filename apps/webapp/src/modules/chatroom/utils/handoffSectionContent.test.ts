import { describe, expect, it } from 'vitest';

import {
  isNotApplicableContent,
  parseMarkdownH2Sections,
  extractH2Section,
  isHandoffSectionEmpty,
  countNonemptySubsections,
} from './handoffSectionContent';

describe('isNotApplicableContent', () => {
  it('returns true for bare Not Applicable', () => {
    expect(isNotApplicableContent('Not Applicable')).toBe(true);
  });

  it('returns true for - Not Applicable bullet', () => {
    expect(isNotApplicableContent('- Not Applicable')).toBe(true);
  });

  it('returns true for multi-line all N/A', () => {
    const text = '- Not Applicable\n- Not applicable\nNot Applicable.';
    expect(isNotApplicableContent(text)).toBe(true);
  });

  it('returns true when only HTML comments', () => {
    expect(isNotApplicableContent('<!-- nothing -->')).toBe(true);
  });

  it('returns false for mermaid block', () => {
    const text = '```mermaid\nflowchart TD\nA --> B\n```';
    expect(isNotApplicableContent(text)).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isNotApplicableContent('')).toBe(true);
  });

  it('returns false for mixed real and N/A lines', () => {
    const text = '- [high] Critical issue\n- Not Applicable';
    expect(isNotApplicableContent(text)).toBe(false);
  });
});

describe('parseMarkdownH2Sections', () => {
  it('parses multiple H2 sections', () => {
    const body = '## Summary\nOne\n\n## What changed\nTwo';
    const sections = parseMarkdownH2Sections(body);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Summary');
    expect(sections[0].content.trim()).toBe('One');
    expect(sections[1].heading).toBe('What changed');
    expect(sections[1].content.trim()).toBe('Two');
  });

  it('returns empty when no H2 sections', () => {
    expect(parseMarkdownH2Sections('Just a paragraph')).toEqual([]);
  });
});

describe('extractH2Section', () => {
  const body = '## Key Technical Decisions\nJWT\n\n## System Design\n```mermaid\nA --> B\n```';

  it('extracts System Design', () => {
    const { extracted, remainder } = extractH2Section(body, 'System Design');
    expect(extracted).toContain('mermaid');
    expect(remainder).toContain('Key Technical Decisions');
    expect(remainder).not.toContain('System Design');
  });

  it('returns null when heading is absent', () => {
    const { extracted, remainder } = extractH2Section(body, 'Not Present');
    expect(extracted).toBeNull();
    expect(remainder).toBe(body);
  });

  it('is case-insensitive', () => {
    const { extracted } = extractH2Section(body, 'system design');
    expect(extracted).toContain('mermaid');
  });
});

describe('isHandoffSectionEmpty', () => {
  it('returns true when all subsections are N/A', () => {
    const body = '## First\nNot Applicable\n\n## Second\n- Not Applicable';
    expect(isHandoffSectionEmpty(body)).toBe(true);
  });

  it('returns false when one subsection has real content', () => {
    const body = '## First\nReal content\n\n## Second\nNot Applicable';
    expect(isHandoffSectionEmpty(body)).toBe(false);
  });

  it('returns false for no-H2 section with real content', () => {
    expect(isHandoffSectionEmpty('Real paragraph content')).toBe(false);
  });
});

describe('countNonemptySubsections', () => {
  it('returns 1 for no-H2 section with content', () => {
    expect(countNonemptySubsections('Real paragraph')).toBe(1);
  });

  it('returns 0 for no-H2 section all N/A', () => {
    expect(countNonemptySubsections('Not Applicable')).toBe(0);
  });

  it('counts non-empty H2 subsections', () => {
    const body = '## First\nReal\n\n## Second\nNot Applicable\n\n## Third\nReal too';
    expect(countNonemptySubsections(body)).toBe(2);
  });
});
