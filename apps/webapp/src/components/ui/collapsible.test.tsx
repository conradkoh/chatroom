import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

describe('Collapsible', () => {
  it('shows content when expanded', async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger render={<Button />}>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>
    );
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
  });
});
