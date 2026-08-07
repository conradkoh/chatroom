import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders and accepts multiline input', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<Textarea aria-label="Notes" />);
    const textarea = screen.getByLabelText('Notes');
    await user.type(textarea, 'Line 1{Enter}Line 2');
    expect(textarea).toHaveValue('Line 1\nLine 2');
  });

  it('respects disabled state', () => {
    render(<Textarea disabled aria-label="Disabled" />);
    expect(screen.getByLabelText('Disabled')).toBeDisabled();
  });
});
