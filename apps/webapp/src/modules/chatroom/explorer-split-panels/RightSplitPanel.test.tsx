import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RightSplitPanel } from './RightSplitPanel';

vi.mock('./MessagesPanel', () => ({
  MessagesPanel: () => <div data-testid="messages-panel">Messages</div>,
}));

const CHATROOM_ID = 'cr1' as never;

describe('RightSplitPanel', () => {
  it('renders the messages panel without a direct harness mode switcher', () => {
    render(<RightSplitPanel chatroomId={CHATROOM_ID} messagesPanelProps={{}} />);

    expect(screen.getByTestId('right-split-panel')).toBeInTheDocument();
    expect(screen.getByTestId('messages-panel')).toBeInTheDocument();
    expect(screen.queryByText('Direct Harness')).not.toBeInTheDocument();
  });
});
