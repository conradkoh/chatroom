import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatroomStatusIndicator } from './ChatroomStatusIndicator';

describe('ChatroomStatusIndicator', () => {
  it('renders the red error token for a stuck chatroom', () => {
    render(<ChatroomStatusIndicator activityStatus="stuck" />);
    const dot = screen.getByLabelText('An agent with assigned work is offline or errored');
    expect(dot.className).toContain('bg-chatroom-status-error');
    expect(dot.className).not.toContain('bg-chatroom-status-info');
  });
});
