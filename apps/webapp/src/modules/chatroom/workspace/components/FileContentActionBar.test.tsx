import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileContentActionBar } from './FileContentActionBar';

describe('FileContentActionBar', () => {
  it('renders Copy button with label', () => {
    render(<FileContentActionBar copyLabel="Copy File Content" onCopy={vi.fn()} />);
    expect(screen.getByRole('button', { name: /copy file content/i })).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('calls onCopy when clicked', () => {
    const onCopy = vi.fn();
    render(<FileContentActionBar copyLabel="Copy File Content" onCopy={onCopy} />);
    screen.getByRole('button', { name: /copy file content/i }).click();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('disables button when disabled is true', () => {
    render(<FileContentActionBar copyLabel="Copy File Content" onCopy={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /copy file content/i })).toBeDisabled();
  });

  it('renders leading and trailing content', () => {
    render(
      <FileContentActionBar
        copyLabel="Copy"
        onCopy={vi.fn()}
        leading={<span data-testid="leading">Leading</span>}
        trailing={<span data-testid="trailing">Trailing</span>}
      />
    );
    expect(screen.getByTestId('leading')).toHaveTextContent('Leading');
    expect(screen.getByTestId('trailing')).toHaveTextContent('Trailing');
  });
});
