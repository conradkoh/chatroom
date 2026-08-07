import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollArea } from './scroll-area';

describe('ScrollArea', () => {
  it('renders scrollable content', () => {
    render(
      <ScrollArea className="h-20 w-20">
        <div>Scrollable item</div>
      </ScrollArea>
    );
    expect(screen.getByText('Scrollable item')).toBeInTheDocument();
  });
});
