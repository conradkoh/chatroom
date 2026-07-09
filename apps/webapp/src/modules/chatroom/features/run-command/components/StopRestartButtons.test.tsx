import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { StopRestartButtons } from './StopRestartButtons';

describe('StopRestartButtons', () => {
  test('renders both Stop and Restart labeled buttons', () => {
    render(<StopRestartButtons active onStop={vi.fn()} onRestart={vi.fn()} />);
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('Restart')).toBeTruthy();
  });

  test('disables Stop when inactive', () => {
    render(<StopRestartButtons active={false} onStop={vi.fn()} onRestart={vi.fn()} />);
    expect(screen.getByText('Stop')).toBeDisabled();
    expect(screen.getByText('Restart')).not.toBeDisabled();
  });

  test('icon variant renders both buttons', () => {
    render(<StopRestartButtons variant="icon" active onStop={vi.fn()} onRestart={vi.fn()} />);
    expect(screen.getByTitle('Stop')).toBeTruthy();
    expect(screen.getByTitle('Restart')).toBeTruthy();
  });
});
