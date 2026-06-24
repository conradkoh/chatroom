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

  it('hides Resume session when harness does not support session resume', () => {
    render(<RemoteAgentAdvancedSettings {...baseProps} disabled />);

    expect(screen.queryByText('Resume session')).not.toBeInTheDocument();
  });

  it('hides Resume session for CLI harnesses', () => {
    render(<RemoteAgentAdvancedSettings {...baseProps} agentHarness="cursor" />);

    expect(screen.queryByText('Resume session')).not.toBeInTheDocument();
  });
});
