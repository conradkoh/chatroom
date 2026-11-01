import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomAgentsRescanButton } from './CustomAgentsRescanButton';

const mocks = vi.hoisted(() => ({ requestRefresh: vi.fn() }));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestRefresh,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { customAgents: { requestRefresh: 'customAgents.requestRefresh' } },
}));

function renderButton(): void {
  render(
    <CustomAgentsRescanButton
      chatroomId="chatroom-1"
      canRescan
      disabledReason={null}
      changeSignature="sig-1"
    />
  );
}

function clickRescan(): void {
  fireEvent.click(screen.getByTestId('custom-agents-rescan'));
}

/** Flushes the mutation promise so the phase moves from `requesting` to `waiting`. */
async function flushRequest(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('CustomAgentsRescanButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.requestRefresh.mockResolvedValue({ queued: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps waiting when a second rescan starts before the first idle timer fires', async () => {
    renderButton();

    // First rescan: the 10 s wait ends with "No changes found." and schedules a
    // return to idle six seconds later.
    clickRescan();
    await flushRequest();
    await advance(10_000);
    expect(screen.getByText('No changes found.')).toBeTruthy();

    // Second rescan starts two seconds later, while the first idle timer is armed.
    await advance(2_000);
    clickRescan();
    await flushRequest();
    expect(screen.getByText('This can take a few seconds.')).toBeTruthy();

    // Advancing past the first timer's deadline must not force the idle phase.
    await advance(6_000);
    expect(screen.getByText('This can take a few seconds.')).toBeTruthy();
    expect(screen.getByTestId('custom-agents-rescan').textContent).toContain('Rescanning');
  });

  it('returns to idle after the last rescan finishes', async () => {
    renderButton();

    clickRescan();
    await flushRequest();
    await advance(10_000);
    expect(screen.getByText('No changes found.')).toBeTruthy();

    await advance(6_000);
    expect(screen.queryByText('No changes found.')).toBeNull();
    expect(screen.getByTestId('custom-agents-rescan').textContent).toContain('Rescan');
  });
});
