import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DirectHarnessView } from './DirectHarnessView';

const mockUseSessionQuery = vi.fn();
const mockUseSessionMutation = vi.fn(() => vi.fn().mockResolvedValue({}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...(args as [])),
}));

describe('DirectHarnessView', () => {
  it('renders the loading state while workspaces are being fetched', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<DirectHarnessView chatroomId={'fakeid' as never} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the no-workspace empty state when workspaces are empty', () => {
    mockUseSessionQuery
      .mockReturnValueOnce([])                                                          // workspaces
      .mockReturnValueOnce({ machines: [{ machineId: 'm1', hostname: 'localhost' }] }); // machines
    render(<DirectHarnessView chatroomId={'fakeid' as never} />);
    expect(screen.getByText(/register a workspace/i)).toBeInTheDocument();
  });
});
