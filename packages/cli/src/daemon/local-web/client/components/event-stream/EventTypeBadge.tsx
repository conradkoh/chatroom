import { resolveEventTypeMeta } from '@/domain/event-type-catalog';
import { getClassificationStyle } from '@/domain/event-classification';
import { cn } from '@/lib/utils';
export function EventTypeBadge({ type, className }: { type: string; className?: string }) { const meta = resolveEventTypeMeta(type); return <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', getClassificationStyle(meta.classification).badge, className)}>{meta.label}</span>; }
