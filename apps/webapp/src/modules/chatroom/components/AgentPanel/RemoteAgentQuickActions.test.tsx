import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { RemoteAgentQuickActions } from './RemoteAgentQuickActions';

describe('RemoteAgentQuickActions', () => {
  test('renders stop + restart when running, not start', () => {
    render(
      <RemoteAgentQuickActions
        hasRunningAgents
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByTitle('Stop agents')).toBeTruthy();
    expect(screen.getByTitle('Restart agents')).toBeTruthy();
    expect(screen.queryByTitle('Start agents')).toBeNull();
  });

  test('renders start only when not running', () => {
    render(
      <RemoteAgentQuickActions
        hasRunningAgents={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByTitle('Start agents')).toBeTruthy();
    expect(screen.queryByTitle('Stop agents')).toBeNull();
    expect(screen.queryByTitle('Restart agents')).toBeNull();
  });

  test('returns null when no handlers and not running', () => {
    const { container } = render(<RemoteAgentQuickActions hasRunningAgents={false} />);

    expect(container.innerHTML).toBe('');
  });

  test('disabled prop disables buttons when running', () => {
    render(
      <RemoteAgentQuickActions hasRunningAgents onStop={vi.fn()} onRestart={vi.fn()} disabled />
    );

    expect(screen.getByTitle('Stop agents')).toBeDisabled();
    expect(screen.getByTitle('Restart agents')).toBeDisabled();
  });

  test('disabled prop disables start button when not running', () => {
    render(<RemoteAgentQuickActions hasRunningAgents={false} onStart={vi.fn()} disabled />);

    expect(screen.getByTitle('Start agents')).toBeDisabled();
  });

  test('click handlers fire', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const onRestart = vi.fn();

    const { rerender } = render(
      <RemoteAgentQuickActions
        hasRunningAgents
        onStart={onStart}
        onStop={onStop}
        onRestart={onRestart}
      />
    );

    screen.getByTitle('Stop agents').click();
    expect(onStop).toHaveBeenCalledTimes(1);

    screen.getByTitle('Restart agents').click();
    expect(onRestart).toHaveBeenCalledTimes(1);

    rerender(
      <RemoteAgentQuickActions
        hasRunningAgents={false}
        onStart={onStart}
        onStop={onStop}
        onRestart={onRestart}
      />
    );

    screen.getByTitle('Start agents').click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
