import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'gap-0.5',
  md: 'gap-1',
  lg: 'gap-1.5',
  xl: 'gap-2',
} as const;

const SQUARE_CLASSES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
  xl: 'h-4 w-4',
} as const;

/**
 * Non-rotating loader — four squares in a 2×2 grid cross-fading by side pairs:
 * top (0,1) → right (1,3) → bottom (2,3) → left (0,2).
 */
export function ChatroomLoader({
  className,
  size = 'md',
}: {
  className?: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 grid-cols-2 grid-rows-2 items-center',
        SIZE_CLASSES[size],
        className
      )}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={cn('chatroom-loader-square shrink-0', SQUARE_CLASSES[size])} />
      ))}
    </span>
  );
}
