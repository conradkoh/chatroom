import dynamic from 'next/dynamic';

export const RichTextEditor = dynamic(
  () => import('./ChatroomModalMarkdownEditor').then((m) => ({ default: m.ChatroomModalMarkdownEditor })),
  { ssr: false }
);

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement)?.closest?.('button, a, input, textarea, select, label');
}
