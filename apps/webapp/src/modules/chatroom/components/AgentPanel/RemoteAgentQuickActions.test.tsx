import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { RemoteAgentQuickActions } from './RemoteAgentQuickActions';

describe('RemoteAgentQuickActions', () => {
  test('when running: stop and restart enabled, start disabled', () => {
    render(
      <RemoteAgentQuickActions
        hasRunningAgents
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByTitle('Start agents')).toBeDisabled();
    expect(screen.getByTitle('Stop agents')).not.toBeDisabled();
    expect(screen.getByTitle('Restart agents')).not.toBeDisabled();
  });

  test('when stopped: start enabled, stop and restart disabled', () => {
    render(
      <RemoteAgentQuickActions
        hasRunningAgents={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByTitle('Start agents')).not.toBeDisabled();
    expect(screen.getByTitle('Stop agents')).toBeDisabled();
    expect(screen.getByTitle('Restart agents')).toBeDisabled();
  });

  test('during restart: stop and restart stay enabled while start is disabled', () => {
    render(
      <RemoteAgentQuickActions
        hasRunningAgents={false}
        isRestarting
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByTitle('Start agents')).toBeDisabled();
    expect(screen.getByTitle('Stop agents')).not.toBeDisabled();
    expect(screen.getByTitle('Restart agents')).not.toBeDisabled();
  });

  test('renders all three buttons even without handlers (all disabled)', () => {
    render(<RemoteAgentQuickActions hasRunningAgents={false} />);

    expect(screen.getByTitle('Start agents')).toBeDisabled();
    expect(screen.getByTitle('Stop agents')).toBeDisabled();
    expect(screen.getByTitle('Restart agents')).toBeDisabled();
  });

  test('renders fixed-width container', () => {
    render(<RemoteAgentQuickActions hasRunningAgents={false} onStart={vi.fn()} />);

    expect(screen.getByTestId('remote-agent-quick-actions')).toHaveClass('w-[4.5rem]');
  });

  test('disabled prop disables all buttons when running', () => {
    render(
      <RemoteAgentQuickActions hasRunningAgents onStop={vi.fn()} onRestart={vi.fn()} disabled />
    );

    expect(screen.getByTitle('Start agents')).toBeDisabled();
    expect(screen.getByTitle('Stop agents')).toBeDisabled();
    expect(screen.getByTitle('Restart agents')).toBeDisabled();
  });

  test('disabled prop disables start when stopped', () => {
    render(<RemoteAgentQuickActions hasRunningAgents={false} onStart={vi.fn()} disabled />);

    expect(screen.getByTitle('Start agents')).toBeDisabled();
  });

  test('click handlers fire on enabled buttons', () => {
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
