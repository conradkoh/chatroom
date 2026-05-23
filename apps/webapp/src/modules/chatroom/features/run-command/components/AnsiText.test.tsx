/**
 * AnsiText unit tests
 *
 * Covers: plain text pass-through, ANSI color rendering, URL linkification,
 * mixed ANSI+URL input, and stray control char safety.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnsiText } from './AnsiText';

describe('AnsiText', () => {
  it('renders plain text unchanged', () => {
    const { container } = render(<AnsiText text="Hello, world!" />);
    expect(container.textContent).toBe('Hello, world!');
  });

  it('parses red ANSI sequence and applies red color styling', () => {
    const { container } = render(<AnsiText text={"\x1b[31mfoo\x1b[0m"} />);
    // Text content should be "foo"
    expect(container.textContent).toContain('foo');
    // The span with the styled text should have a red color
    const styledSpan = container.querySelector('span[style]');
    expect(styledSpan).not.toBeNull();
    expect(styledSpan?.getAttribute('style')).toContain('color');
  });

  it('linkifies https:// URLs into anchors', () => {
    render(<AnsiText text="Visit https://example.com today" />);
    const anchor = screen.getByRole('link');
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('href')).toBe('https://example.com');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.textContent).toBe('https://example.com');
  });

  it('linkifies file:// URLs into anchors', () => {
    render(<AnsiText text="Open file:///tmp/foo.log here" />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('href')).toBe('file:///tmp/foo.log');
  });

  it('does not linkify plain text without a URL scheme', () => {
    const { container } = render(<AnsiText text="example.com or ftp://ignored.com" />);
    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(0);
  });

  it('handles mixed ANSI color + URL in same token', () => {
    // Green colored text containing a URL
    const { container } = render(
      <AnsiText text={'\x1b[32mDone: https://ci.example.com/build/1\x1b[0m'} />
    );
    // The anchor should exist
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://ci.example.com/build/1');
    // The parent span should have green color styling
    const styledSpan = container.querySelector('span[style]');
    expect(styledSpan?.getAttribute('style')).toContain('color');
  });

  it('renders bold text with fontWeight bold', () => {
    const { container } = render(<AnsiText text={"\x1b[1mBold text\x1b[0m"} />);
    const styledSpan = container.querySelector('span[style]');
    expect(styledSpan?.getAttribute('style')).toContain('font-weight: bold');
  });

  it('renders underline text with text-decoration underline', () => {
    const { container } = render(<AnsiText text={"\x1b[4mUnderlined\x1b[0m"} />);
    const styledSpan = container.querySelector('span[style]');
    expect(styledSpan?.getAttribute('style')).toContain('underline');
  });

  it('does not crash on stray control characters', () => {
    // Stray ESC without a valid sequence
    expect(() =>
      render(<AnsiText text={'Hello\x1b[999mWorld\x00\x07'} />)
    ).not.toThrow();
  });

  it('renders empty string without crashing', () => {
    const { container } = render(<AnsiText text="" />);
    expect(container.textContent).toBe('');
  });

  it('renders multiple sequential ANSI sequences correctly', () => {
    const { container } = render(
      <AnsiText text={'\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m \x1b[34mBlue\x1b[0m'} />
    );
    expect(container.textContent).toContain('Red');
    expect(container.textContent).toContain('Green');
    expect(container.textContent).toContain('Blue');
    const styledSpans = container.querySelectorAll('span[style]');
    expect(styledSpans.length).toBeGreaterThanOrEqual(3);
  });
});
