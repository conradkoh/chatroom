import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'bg-color': [
        {
          bg: [
            'chatroom-bg-primary',
            'chatroom-bg-secondary',
            'chatroom-bg-tertiary',
            'chatroom-bg-hover',
            'chatroom-bg-surface',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
