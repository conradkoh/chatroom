/**
 * Industrial Design System Spinner
 *
 * A loading indicator that follows the Industrial Design System principles:
 * - Square indicators over circles (brutalist structure)
 * - Color as signal (uses status colors appropriately)
 * - Utilitarian first (minimal, functional design)
 */

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { cn } from '@/lib/utils';

type SpinnerSize = 'sm' | 'md' | 'lg';
type SpinnerVariant = 'default' | 'primary' | 'muted';

interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
};

const variantClasses: Record<SpinnerVariant, string> = {
  default: 'bg-zinc-100',
  primary: 'bg-blue-400',
  muted: 'bg-zinc-500',
};

/**
 * Industrial spinner using a pulsing square block
 * Following the design system's preference for squares over circles
 */
export function Spinner({ size = 'md', variant = 'default', className }: SpinnerProps) {
  return (
    <div
      className={cn(sizeClasses[size], variantClasses[variant], 'animate-pulse', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Four-square 2×2 loader — matches ChatroomLoader used across the chatroom UI. */
export function SpinnerBlocks({ size = 'md', className }: Omit<SpinnerProps, 'variant'>) {
  return <ChatroomLoader size={size} className={className} />;
}

/**
 * Page-level loading state with message
 * Industrial design: centered, minimal, informative
 */
interface PageSpinnerProps {
  message?: string;
}

export function PageSpinner({ message = 'Loading...' }: PageSpinnerProps) {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col items-center gap-3">
        <ChatroomLoader size="xl" />
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">{message}</p>
      </div>
    </div>
  );
}

/**
 * Inline loading state for buttons and form elements
 */
interface InlineSpinnerProps {
  className?: string;
}

export function InlineSpinner({ className }: InlineSpinnerProps) {
  return <Spinner size="sm" variant="muted" className={className} />;
}
