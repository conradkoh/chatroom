import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsBar } from './StandingInstructionsBar';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

const mockUpsert = vi.fn();
const mockSetEnabled = vi.fn();
const mockClear = vi.fn();
let mockQueryResult: { content: string; enabled: boolean } = { content: '', enabled: false };

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mockQueryResult,
  useSessionMutation: () => {
    const fns: Record<string, typeof mockUpsert> = {
      'standingInstructions:upsert': mockUpsert,
      'standingInstructions:setEnabled': mockSetEnabled,
      'standingInstructions:clear': mockClear,
    };
    return (name: string) => fns[name];
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    standingInstructions: {
      get: 'standingInstructions:get',
      upsert: 'standingInstructions:upsert',
      setEnabled: 'standingInstructions:setEnabled',
      clear: 'standingInstructions:clear',
    },
  },
}));

const ROOM_ID = 'room1' as Id<'chatroom_rooms'>;

describe('StandingInstructionsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { content: '', enabled: false };
  });

  it('shows add button when no standing instructions', () => {
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
  });

  it('shows preview when active', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Standing instructions')).toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Disable')).toBeInTheDocument();
  });

  it('opens edit mode on add button click', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
