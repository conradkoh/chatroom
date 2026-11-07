/**
 * Regression: the scheduled-prompt actions popover must use the shared opaque
 * portaled-menu surface (bg-chatroom-bg-primary), not the translucent
 * bg-chatroom-bg-secondary token (rgba alpha 0.6 light / 0.5 dark).
 *
 * Uses the real shared Popover (not mocked) so the className merge is observed.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScheduledPromptCard } from './ScheduledPromptCard';

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

vi.mock('./ScheduledPromptDetailDialog', () => ({
  ScheduledPromptDetailDialog: () => null,
}));

const PROMPT = {
  _id: 'prompt-1' as any,
  name: 'One shot',
  prompt: 'Run once',
  scheduleKind: 'once' as const,
  runAt: 1_800_000_000_000,
};

const TRANSLUCENT_BG = /(^|\s)bg-chatroom-bg-(secondary|surface)(\s|$)|(^|\s)bg-[\w-]+\/\d+(\s|$)/;

describe('ScheduledPromptCard actions popover surface', () => {
  it('renders the desktop actions popover on the opaque shared surface token', async () => {
    render(
      <ScheduledPromptCard
        prompt={PROMPT}
        onEdit={vi.fn()}
        setEnabled={vi.fn().mockResolvedValue(undefined)}
        removePrompt={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('scheduled-prompt-card'));

    const popup = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
      expect(el).not.toBeNull();
      return el!;
    });

    expect(popup.className).not.toMatch(TRANSLUCENT_BG);
    expect(popup.className).toMatch(/(^|\s)bg-chatroom-bg-primary(\s|$)/);
  });
});
