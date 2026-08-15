import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DetailModalMarkdownSurface } from './DetailModalMarkdownSurface';

describe('DetailModalMarkdownSurface', () => {
  it('applies shared modal markdown prose and scroll layout classes', () => {
    render(<DetailModalMarkdownSurface data-testid="surface">content</DetailModalMarkdownSurface>);
    const el = screen.getByTestId('surface');
    expect(el.className).toContain('overflow-y-auto');
    expect(el.className).toContain('p-4');
    expect(el.className).toContain('prose');
    expect(el.className).toContain('ProseMirror_pre');
  });
});
