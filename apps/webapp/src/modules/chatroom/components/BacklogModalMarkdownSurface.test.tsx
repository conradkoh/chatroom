import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BacklogModalMarkdownSurface } from './BacklogModalMarkdownSurface';

describe('BacklogModalMarkdownSurface', () => {
  it('applies shared modal markdown prose and scroll layout classes', () => {
    render(<BacklogModalMarkdownSurface data-testid="surface">content</BacklogModalMarkdownSurface>);
    const el = screen.getByTestId('surface');
    expect(el.className).toContain('overflow-y-auto');
    expect(el.className).toContain('p-4');
    expect(el.className).toContain('prose');
    expect(el.className).toContain('ProseMirror_pre');
  });
});
