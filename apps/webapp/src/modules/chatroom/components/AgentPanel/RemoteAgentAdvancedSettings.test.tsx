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

  it('shows Resume session for daemon-memory-capable harnesses', () => {
    render(<RemoteAgentAdvancedSettings {...baseProps} disabled />);

    expect(screen.getByText('Resume session')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Resume session' })).toBeDisabled();
  });

  it('hides Resume session for harnesses without daemon-memory resume', () => {
    render(<RemoteAgentAdvancedSettings {...baseProps} agentHarness="cursor" />);

    expect(screen.queryByText('Resume session')).not.toBeInTheDocument();
  });
});
