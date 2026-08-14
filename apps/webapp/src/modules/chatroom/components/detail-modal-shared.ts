import dynamic from 'next/dynamic';

export const RichTextEditor = dynamic(
  () => import('./rich-text').then((m) => ({ default: m.RichTextEditor })),
  { ssr: false }
);

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement)?.closest?.('button, a, input, textarea, select, label');
}
