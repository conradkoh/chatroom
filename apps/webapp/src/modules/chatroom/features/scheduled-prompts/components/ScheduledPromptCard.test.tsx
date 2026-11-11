import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledPromptCard } from './ScheduledPromptCard';

// Pin the timezone so the formatted timestamp literals are stable everywhere.
beforeAll(() => {
  vi.stubEnv('TZ', 'UTC');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}));

const desktopMock = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => desktopMock.value,
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children, open }: any) => (open ? <div data-testid="popover">{children}</div> : null),
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, disabled, onClick }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => {
        onCheckedChange?.(e.target.checked);
      }}
      disabled={disabled}
      onClick={onClick}
      role="switch"
      data-testid="switch"
    />
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className }: any) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

vi.mock('./ScheduledPromptDetailDialog', () => ({
  ScheduledPromptDetailDialog: () => null,
}));

const RUN_AT = 1_800_000_000_000;

const BASE_PROMPT = {
  _id: 'prompt-1' as any,
  name: 'One shot',
  prompt: 'Run once',
  scheduleKind: 'once' as const,
  runAt: RUN_AT,
};

describe('ScheduledPromptCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktopMock.value = true;
  });

  it('shows the Completed badge, once schedule, and hides switch and Edit for a finished row', async () => {
    render(
      <ScheduledPromptCard
        prompt={{ ...BASE_PROMPT, disabledReason: 'completed', lastRunAt: RUN_AT }}
        onEdit={vi.fn()}
        setEnabled={vi.fn()}
        removePrompt={vi.fn()}
      />
    );

    expect(screen.getByText('Completed')).toBeDefined();
    expect(screen.getByText('Once on 15th January 2027, 8:00am')).toBeDefined();
    expect(screen.getByText('View trigger history')).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();

    fireEvent.click(screen.getByTestId('scheduled-prompt-card'));
    await waitFor(() => {
      expect(screen.getByTestId('popover-content')).toBeDefined();
    });
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('shows the Failed badge and hides the switch for a failed row', () => {
    render(
      <ScheduledPromptCard
        prompt={{ ...BASE_PROMPT, disabledReason: 'failed' }}
        onEdit={vi.fn()}
        setEnabled={vi.fn()}
        removePrompt={vi.fn()}
      />
    );

    expect(screen.getByText('Failed')).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the switch and Edit for a pending one-time row', async () => {
    render(
      <ScheduledPromptCard
        prompt={BASE_PROMPT}
        onEdit={vi.fn()}
        setEnabled={vi.fn().mockResolvedValue(undefined)}
        removePrompt={vi.fn()}
      />
    );

    expect(screen.getByRole('switch')).toBeDefined();

    fireEvent.click(screen.getByTestId('scheduled-prompt-card'));
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
  });

  it('toasts the server message when a toggle is rejected', async () => {
    const message = 'Scheduled time has passed — edit the prompt to pick a new time';
    const setEnabled = vi.fn().mockRejectedValue({ data: { message } });

    render(
      <ScheduledPromptCard
        prompt={BASE_PROMPT}
        onEdit={vi.fn()}
        setEnabled={setEnabled}
        removePrompt={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(message);
    });
  });

  it('shows the session and mode', () => {
    const { rerender } = render(
      <ScheduledPromptCard
        prompt={BASE_PROMPT}
        onEdit={vi.fn()}
        setEnabled={vi.fn()}
        removePrompt={vi.fn()}
      />
    );

    expect(screen.getByTestId('scheduled-prompt-card-policy')).toHaveTextContent(
      'New session · Code'
    );

    rerender(
      <ScheduledPromptCard
        prompt={{
          ...BASE_PROMPT,
          taskEnvelope: {
            version: 1,
            conversationMode: 'chat',
            sessionPolicy: 'continue',
            handoffWorkflow: { preset: 'direct', phase: 'entry' },
          },
        }}
        onEdit={vi.fn()}
        setEnabled={vi.fn()}
        removePrompt={vi.fn()}
      />
    );

    expect(screen.getByTestId('scheduled-prompt-card-policy')).toHaveTextContent(
      'Existing session · Chat'
    );
  });
});
