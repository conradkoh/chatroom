import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'gap-0.5',
  md: 'gap-1',
  lg: 'gap-1.5',
} as const;

const SQUARE_CLASSES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
} as const;

/** Non-rotating loader — four squares fading through grey / black / white shades. */
export function ChatroomLoader({
  className,
  size = 'md',
}: {
  className?: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <span
      className={cn('inline-grid shrink-0 grid-cols-4 items-center', SIZE_CLASSES[size], className)}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={cn('chatroom-loader-square shrink-0', SQUARE_CLASSES[size])}
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </span>
  );
}
