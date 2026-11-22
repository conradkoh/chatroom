import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type FeedbackTone = 'error' | 'warning' | 'success' | 'info';

export interface Feedback {
  id: number;
  tone: FeedbackTone;
  message?: string;
  title?: string;
  items?: string[];
  /** Per-feedback icon flag. Defaults to true. `InlineFeedbackProps.icon` overrides it. */
  icon?: boolean;
}

export interface InlineFeedbackProps {
  /** null renders nothing and reserves no space. */
  feedback: Feedback | null;
  /** Box variant only: when provided, renders the Dismiss button. */
  onDismiss?: () => void;
  /** Default 'box'. 'text' renders a plain paragraph with no border or background. */
  variant?: 'box' | 'text';
  /** Overrides `feedback.icon`. Default resolution: props.icon ?? feedback.icon ?? true. */
  icon?: boolean;
  className?: string;
  'data-testid'?: string;
}

const TONE: Record<FeedbackTone, { box: string; text: string; Icon: LucideIcon }> = {
  error: {
    box: 'border-chatroom-status-error/40 bg-chatroom-status-error/10 text-chatroom-status-error',
    text: 'text-chatroom-status-error',
    Icon: AlertCircle,
  },
  warning: {
    box: 'border-chatroom-status-warning/40 bg-chatroom-status-warning/10 text-chatroom-status-warning',
    text: 'text-chatroom-status-warning',
    Icon: AlertTriangle,
  },
  success: {
    box: 'border-chatroom-status-success/40 bg-chatroom-status-success/10 text-chatroom-status-success',
    text: 'text-chatroom-status-success',
    Icon: CheckCircle2,
  },
  info: {
    box: 'border-chatroom-status-info/40 bg-chatroom-status-info/10 text-chatroom-status-info',
    text: 'text-chatroom-status-info',
    Icon: Info,
  },
};

/** Errors interrupt; every other tone is polite. */
function toneRole(tone: FeedbackTone): 'alert' | 'status' {
  return tone === 'error' ? 'alert' : 'status';
}

/** Props win over the per-feedback flag, which wins over the default. */
function resolveIcon(feedback: Feedback, icon: boolean | undefined): boolean {
  return icon ?? feedback.icon ?? true;
}

function FeedbackText({
  feedback,
  testId,
  className,
}: {
  feedback: Feedback;
  testId: string;
  className?: string;
}) {
  return (
    <p
      key={feedback.id}
      role={toneRole(feedback.tone)}
      data-testid={testId}
      className={cn('break-words text-xs', TONE[feedback.tone].text, className)}
    >
      {feedback.message}
    </p>
  );
}

/** Renders nothing, rather than an empty list, when there are no items. */
function FeedbackItemList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;

  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function FeedbackDetails({ feedback }: { feedback: Feedback }) {
  const { title, message, items } = feedback;

  return (
    <div className="min-w-0 flex-1 space-y-1 break-words">
      {title && <p className="font-semibold">{title}</p>}
      {message && <p>{message}</p>}
      <FeedbackItemList items={items} />
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss"
      className="-m-1 shrink-0 p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current"
    >
      <X size={12} aria-hidden />
    </button>
  );
}

function FeedbackBox({
  feedback,
  showIcon,
  onDismiss,
  testId,
  className,
}: {
  feedback: Feedback;
  showIcon: boolean;
  onDismiss?: () => void;
  testId: string;
  className?: string;
}) {
  const { Icon } = TONE[feedback.tone];

  return (
    <div
      key={feedback.id}
      role={toneRole(feedback.tone)}
      data-testid={testId}
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-none border p-3 text-xs',
        TONE[feedback.tone].box,
        className
      )}
    >
      {showIcon && <Icon size={14} aria-hidden className="mt-0.5 shrink-0" />}
      <FeedbackDetails feedback={feedback} />
      {onDismiss && <DismissButton onDismiss={onDismiss} />}
    </div>
  );
}

export function InlineFeedback({
  feedback,
  onDismiss,
  variant = 'box',
  icon,
  className,
  'data-testid': testId = 'inline-feedback',
}: InlineFeedbackProps) {
  if (!feedback) return null;

  if (variant === 'text') {
    return <FeedbackText feedback={feedback} testId={testId} className={className} />;
  }

  return (
    <FeedbackBox
      feedback={feedback}
      showIcon={resolveIcon(feedback, icon)}
      onDismiss={onDismiss}
      testId={testId}
      className={className}
    />
  );
}
