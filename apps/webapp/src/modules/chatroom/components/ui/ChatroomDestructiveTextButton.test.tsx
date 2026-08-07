import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatroomDestructiveTextButton } from './ChatroomDestructiveTextButton';

describe('ChatroomDestructiveTextButton', () => {
  it('compact renders outlined destructive colors and compact layout', () => {
    render(
      <ChatroomDestructiveTextButton size="compact">Archive Chat</ChatroomDestructiveTextButton>
    );
    const btn = screen.getByRole('button', { name: 'Archive Chat' });
    expect(btn.className).toContain('bg-red-50');
    expect(btn.className).toContain('text-red-600');
    expect(btn.className).toContain('border-red-200');
    expect(btn.className).toContain('text-[10px]');
    expect(btn.className).toContain('uppercase');
  });

  it('industrial renders outlined destructive colors and h-9 layout', () => {
    render(
      <ChatroomDestructiveTextButton size="industrial">Disable</ChatroomDestructiveTextButton>
    );
    const btn = screen.getByRole('button', { name: 'Disable' });
    expect(btn.className).toContain('bg-red-50');
    expect(btn.className).toContain('text-red-600');
    expect(btn.className).toContain('border-red-200');
    expect(btn.className).toContain('h-9');
    expect(btn.className).toContain('text-sm');
  });
});
