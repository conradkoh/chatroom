import { render, screen } from '@testing-library/react';
import { Paperclip } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ComposerAccessoryButton } from './ComposerAccessoryButton';
import { composerAccessoryButtonClassName } from './composerAccessoryButtonStyles';

describe('ComposerAccessoryButton', () => {
  it('renders icon and label with accessory button styles', () => {
    render(
      <ComposerAccessoryButton
        aria-label="Add attachment"
        icon={<Paperclip size={14} aria-hidden data-testid="icon" />}
      >
        Add Attachment
      </ComposerAccessoryButton>
    );

    const button = screen.getByRole('button', { name: 'Add attachment' });
    expect(button).toHaveTextContent('Add Attachment');
    expect(button.className).toContain('bg-chatroom-bg-surface');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('merges custom className', () => {
    render(<ComposerAccessoryButton className="custom-class">Label</ComposerAccessoryButton>);
    const button = screen.getByRole('button', { name: 'Label' });
    expect(button.className).toContain(composerAccessoryButtonClassName.split(' ')[0]);
    expect(button.className).toContain('custom-class');
  });
});
