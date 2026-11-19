'use client';

/**
 * Shared name/description fields for integrations.
 *
 * The limits and the trimming rules come from the backend domain module so the
 * form and the server can never drift apart. Inputs deliberately have no
 * `maxLength`: pasted text is validated live instead of being silently cut.
 */

import {
  INTEGRATION_DESCRIPTION_MAX_LENGTH,
  INTEGRATION_NAME_MAX_LENGTH,
  normalizeIntegrationDetail,
} from '@workspace/backend/src/domain/entities/integration-details';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** Validate both optional detail fields; empty/whitespace-only means "unset". */
export function evaluateIntegrationDetails(name: string, description: string) {
  const n = normalizeIntegrationDetail('name', name);
  const d = normalizeIntegrationDetail('description', description);
  return { name: n, description: d, valid: n.ok && d.ok };
}

export interface IntegrationDetailFieldsProps {
  /** `integ-${id}` or `wizard` — keeps DOM ids unique across rendered panels. */
  idPrefix: string;
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  /** True while saving/connecting. */
  disabled?: boolean;
  /** Edit panel only: explain that emptying a stored field removes it. */
  showClearHints?: boolean;
  hadName?: boolean;
  hadDescription?: boolean;
  /** Enter in the Name input (the edit panel saves when the form is saveable). */
  onNameEnter?: () => void;
}

export function IntegrationDetailFields({
  idPrefix,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  disabled = false,
  showClearHints = false,
  hadName = false,
  hadDescription = false,
  onNameEnter,
}: IntegrationDetailFieldsProps) {
  const r = evaluateIntegrationDetails(name, description);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label
            htmlFor={`${idPrefix}-name`}
            className="text-xs font-bold text-chatroom-text-primary"
          >
            Name <span className="font-normal text-chatroom-text-muted">(optional)</span>
          </Label>
          <span
            className={cn(
              'font-mono text-[11px]',
              !r.name.ok ? 'text-chatroom-status-error' : 'text-chatroom-text-muted'
            )}
          >
            {name.trim().length}/{INTEGRATION_NAME_MAX_LENGTH}
          </span>
        </div>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          disabled={disabled}
          placeholder="e.g. Team alerts"
          aria-invalid={!r.name.ok}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onNameEnter?.()}
          className="border-chatroom-border bg-chatroom-bg-primary text-xs"
        />
        {r.name.ok === false && (
          <p className="text-xs text-chatroom-status-error">{r.name.message}</p>
        )}
        {showClearHints && hadName && name.trim() === '' && (
          <p className="text-[11px] text-chatroom-text-muted">Will be removed.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label
            htmlFor={`${idPrefix}-description`}
            className="text-xs font-bold text-chatroom-text-primary"
          >
            Description <span className="font-normal text-chatroom-text-muted">(optional)</span>
          </Label>
          <span
            className={cn(
              'font-mono text-[11px]',
              !r.description.ok ? 'text-chatroom-status-error' : 'text-chatroom-text-muted'
            )}
          >
            {description.trim().length}/{INTEGRATION_DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
        <Textarea
          id={`${idPrefix}-description`}
          value={description}
          disabled={disabled}
          rows={3}
          placeholder="What is this integration used for?"
          aria-invalid={!r.description.ok}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="min-h-20 resize-y border-chatroom-border bg-chatroom-bg-primary text-xs"
        />
        {r.description.ok === false && (
          <p className="text-xs text-chatroom-status-error">{r.description.message}</p>
        )}
        {showClearHints && hadDescription && description.trim() === '' && (
          <p className="text-[11px] text-chatroom-text-muted">Will be removed.</p>
        )}
      </div>
    </div>
  );
}
