import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentConfigModal } from './AgentConfigModal';

vi.mock('./WorkspaceInlineAgentListPanel', () => ({
  WorkspaceInlineAgentListPanel: ({ role }: { role?: string }) => (
    <div data-testid="agent-list-panel-stub">{role}</div>
  ),
}));

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  chatroomId: 'jd7testchatroom0000000000000001',
  role: 'triage',
  onViewAllAgents: vi.fn(),
};

describe('AgentConfigModal', () => {
  it('shows the configure title and the requested role', () => {
    render(<AgentConfigModal {...baseProps} />);

    expect(screen.getByText('Configure Agent')).toBeInTheDocument();
    expect(screen.getByTestId('agent-config-modal-role')).toHaveTextContent('triage');
    expect(screen.getByTestId('agent-list-panel-stub')).toHaveTextContent('triage');
  });

  it('renders the ephemeral lifecycle chip for ephemeral roles', () => {
    render(<AgentConfigModal {...baseProps} role="triage" />);

    expect(screen.getByTestId('agent-config-modal-lifecycle')).toHaveTextContent('Ephemeral');
  });

  it('renders the permanent lifecycle chip for permanent roles', () => {
    render(<AgentConfigModal {...baseProps} role="planner" />);

    expect(screen.getByTestId('agent-config-modal-lifecycle')).toHaveTextContent('Permanent');
  });

  it('calls onViewAllAgents from the All agents action', () => {
    const onViewAllAgents = vi.fn();
    render(<AgentConfigModal {...baseProps} onViewAllAgents={onViewAllAgents} />);

    fireEvent.click(screen.getByTestId('agent-config-modal-view-all'));

    expect(onViewAllAgents).toHaveBeenCalledTimes(1);
  });

  it('closes from the Close button', () => {
    const onClose = vi.fn();
    render(<AgentConfigModal {...baseProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<AgentConfigModal {...baseProps} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no dialog when closed', () => {
    render(<AgentConfigModal {...baseProps} isOpen={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-config-modal')).not.toBeInTheDocument();
  });
});
