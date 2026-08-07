import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MdxLayout from './MdxLayout';

describe('MdxLayout', () => {
  it('renders children in article', () => {
    render(
      <MdxLayout>
        <p>MDX content</p>
      </MdxLayout>
    );
    expect(screen.getByText('MDX content')).toBeInTheDocument();
    expect(screen.getByText('MDX content').closest('article')).toHaveClass('mdx-content');
  });
});
