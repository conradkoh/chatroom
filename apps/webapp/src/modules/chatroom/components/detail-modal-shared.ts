import dynamic from 'next/dynamic';
import type { KeyboardEvent, MouseEvent } from 'react';

export const RichTextEditor = dynamic(
  () =>
    import('./ChatroomModalMarkdownEditor').then((m) => ({
      default: m.ChatroomModalMarkdownEditor,
    })),
  { ssr: false }
);

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement)?.closest?.('button, a, input, textarea, select, label');
}

/** Shared click/keyboard handlers for detail modal markdown view → edit transitions. */
export function createDetailModalEditSurfaceProps(
  enterEdit: (coords?: { left: number; top: number } | null) => void
) {
  return {
    interactive: true as const,
    onClick: (e: MouseEvent<HTMLDivElement>) => {
      if (isInteractiveClickTarget(e.target)) return;
      enterEdit({ left: e.clientX, top: e.clientY });
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enterEdit(null);
      }
    },
    role: 'button' as const,
    tabIndex: 0,
  };
}
