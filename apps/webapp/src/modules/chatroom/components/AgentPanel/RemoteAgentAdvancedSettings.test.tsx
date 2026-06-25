import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RemoteAgentAdvancedSettings } from './RemoteAgentAdvancedSettings';

describe('RemoteAgentAdvancedSettings', () => {
  const baseProps = {
    role: 'planner',
    agentHarness: 'cursor-sdk' as const,
    resumeSession: true,
    autoRestartOnNewContext: false,
    onResumeSessionChange: vi.fn(),
    onAutoRestartOnNewContextChange: vi.fn(),
  };

  it('shows reconnect toggle for daemon-memory-capable harnesses', () => {
    render(<RemoteAgentAdvancedSettings {...baseProps} disabled />);

    expect(screen.getByText('Reconnect to last session')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Reconnect to last session' })).toBeDisabled();
  });

  it('hides reconnect toggle for harnesses without daemon-memory resume', () => {
    render(<RemoteAgentAdvancedSettings {...baseProps} agentHarness="cursor" />);

    expect(screen.queryByText('Reconnect to last session')).not.toBeInTheDocument();
  });
});
