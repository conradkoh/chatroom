import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2',
} as const;

const DOT_CLASSES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
} as const;

/** Non-rotating loader — three pulsing dots. */
export function ChatroomLoader({
  className,
  size = 'md',
}: {
  className?: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <span
      className={cn('inline-flex items-center', SIZE_CLASSES[size], className)}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn('rounded-full bg-chatroom-accent animate-pulse', DOT_CLASSES[size])}
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  );
}
