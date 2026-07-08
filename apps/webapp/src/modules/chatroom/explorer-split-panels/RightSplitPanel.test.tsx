import { render, screen, fireEvent } from '@testing-library/react';
import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RightSplitPanel } from './RightSplitPanel';
import {
  WORKSPACE_HEADER_ROW_BASE_CLASS,
  WORKSPACE_HEADER_ROW_HEIGHT_CLASS,
} from '../workspace/components/WorkspaceTabBar';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./MessagesPanel', () => ({
  MessagesPanel: () => <div data-testid="messages-panel">Messages</div>,
}));

vi.mock('./DirectHarnessPanel', () => ({
  DirectHarnessPanel: () => <div data-testid="harness-panel">Harness</div>,
}));

// Minimal select mock that triggers onValueChange on item click
const mockOnValueChange = vi.fn();

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange: (v: string) => void;
  }) => {
    mockOnValueChange.mockImplementation(onValueChange);
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <button type="button" data-value={value} onClick={() => mockOnValueChange(value)}>
      {children}
    </button>
  ),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'cr1' as never;
const DEFAULT_MESSAGES_PROPS = {
  coordinator: {
    current: {
      attach: vi.fn(),
      detach: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => true),
    },
  },
  onRegisterOpenEventStream: vi.fn(),
} as any;
const DEFAULT_HARNESS_PROPS = {
  selectedHarnessSessionId: null,
  setSelectedHarnessSessionId: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
});

describe('RightSplitPanel', () => {
  it('shows messages panel by default', () => {
    render(
      <RightSplitPanel
        chatroomId={CHATROOM_ID}
        messagesPanelProps={DEFAULT_MESSAGES_PROPS}
        {...DEFAULT_HARNESS_PROPS}
      />
    );
    expect(screen.getByTestId('messages-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('harness-panel')).not.toBeInTheDocument();
  });

  it('switches to direct-harness panel when mode changes', () => {
    render(
      <RightSplitPanel
        chatroomId={CHATROOM_ID}
        messagesPanelProps={DEFAULT_MESSAGES_PROPS}
        {...DEFAULT_HARNESS_PROPS}
      />
    );
    expect(screen.getByTestId('messages-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Direct Harness'));

    expect(screen.getByTestId('harness-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('messages-panel')).not.toBeInTheDocument();
  });

  it('persists mode to localStorage', () => {
    render(
      <RightSplitPanel
        chatroomId={CHATROOM_ID}
        messagesPanelProps={DEFAULT_MESSAGES_PROPS}
        {...DEFAULT_HARNESS_PROPS}
      />
    );
    fireEvent.click(screen.getByText('Direct Harness'));
    expect(localStorage.getItem('chatroom:cr1:explorerSplitPanelMode')).toBe(
      JSON.stringify('direct-harness')
    );
  });

  it('header row uses the same tab bar shell as file tabs', () => {
    render(
      <RightSplitPanel
        chatroomId={CHATROOM_ID}
        messagesPanelProps={DEFAULT_MESSAGES_PROPS}
        {...DEFAULT_HARNESS_PROPS}
      />
    );

    const header = screen.getByTestId('right-split-panel-header');
    expect(header).toBeTruthy();
    for (const token of WORKSPACE_HEADER_ROW_BASE_CLASS.split(/\s+/)) {
      expect(header.className).toContain(token);
    }
    for (const token of WORKSPACE_HEADER_ROW_HEIGHT_CLASS.split(/\s+/)) {
      expect(header.className).toContain(token);
    }
  });
});
