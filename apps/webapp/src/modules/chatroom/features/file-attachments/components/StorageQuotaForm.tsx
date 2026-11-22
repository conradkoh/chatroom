'use client';

import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import { getFileAttachmentErrorMessage, isQuotaFieldError } from '../lib/fileAttachmentErrors';
import { BYTES_PER_MB, formatFileSize } from '../lib/formatFileSize';

import { InlineFeedback } from '@/components/inline-feedback';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface StorageQuotaFormProps {
  /** Configured quota of this scope, in bytes. */
  quotaBytes: number;
  /** Server-provided ceiling; never hard-code the platform limit here. */
  platformMaxBytes: number;
  /** Current usage of this scope, in bytes. */
  usedBytes: number;
  /** Chatroom only: the user quota that caps the effective chatroom limit. */
  capBytes?: number;
  scopeLabel: 'this chatroom' | 'your account';
  save: (quotaBytes: number) => Promise<{ evictionScheduled: boolean }>;
}

function rangeMessage(maxMb: number): string {
  return `Enter a whole number from 0 to ${maxMb}.`;
}

/** Returns the whole MB value, or `null` when the draft is outside the range. */
function parseDraft(draftMb: string, maxMb: number): number | null {
  const trimmed = draftMb.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const mb = Number(trimmed);
  return mb <= maxMb ? mb : null;
}

/** The chatroom user cap wins only when it is below the configured quota. */
function effectiveLimitFor(quotaBytes: number, capBytes?: number): number {
  return Math.min(quotaBytes, capBytes ?? Infinity);
}

function exceedsUsage(bytes: number, usedBytes: number, capBytes?: number): boolean {
  return effectiveLimitFor(bytes, capBytes) < usedBytes;
}

function errorMessageOf(err: unknown, maxMb: number): string {
  const data = (err as { data?: { message?: string } } | null)?.data;
  return data?.message ?? rangeMessage(maxMb);
}

function asDraftMb(draft: string | null, serverMb: number): string {
  return draft ?? String(serverMb);
}

function isDraftDirty(draft: string | null, serverMb: number): boolean {
  return draft !== null && draft !== String(serverMb);
}

function rangeErrorFor(dirty: boolean, parsedMb: number | null, maxMb: number): string | null {
  return dirty && parsedMb === null ? rangeMessage(maxMb) : null;
}

function pendingEffectiveFor(pendingBytes: number | null, capBytes?: number): number | null {
  return pendingBytes === null ? null : effectiveLimitFor(pendingBytes, capBytes);
}

function confirmCopy(
  scopeLabel: StorageQuotaFormProps['scopeLabel'],
  usedBytes: number,
  effectiveBytes: number
): string {
  const removedBytes = usedBytes - effectiveBytes;
  const subject = scopeLabel.charAt(0).toUpperCase() + scopeLabel.slice(1);
  return `${subject} uses ${formatFileSize(usedBytes)}. The new limit is ${formatFileSize(effectiveBytes)}, so at least ${formatFileSize(removedBytes)} of the oldest files will be removed in the background. Files still uploading are kept.`;
}

type SaveOutcome = { ok: true; evictionScheduled: boolean } | { ok: false; message: string };

/** Runs the mutation and returns the outcome as data. Never shows a transient notification, never throws. */
async function runSave(
  save: StorageQuotaFormProps['save'],
  bytes: number,
  maxMb: number
): Promise<SaveOutcome> {
  try {
    const result = await save(bytes);
    return { ok: true, evictionScheduled: result.evictionScheduled };
  } catch (err) {
    const message = isQuotaFieldError(err)
      ? errorMessageOf(err, maxMb)
      : getFileAttachmentErrorMessage(err);
    return { ok: false, message };
  }
}

function useQuotaDraft(quotaBytes: number, maxMb: number) {
  const [draft, setDraft] = useState<string | null>(null);
  const serverMb = Math.round(quotaBytes / BYTES_PER_MB);
  const draftMb = asDraftMb(draft, serverMb);

  return {
    draftMb,
    dirty: isDraftDirty(draft, serverMb),
    parsedMb: parseDraft(draftMb, maxMb),
    edit: setDraft,
    reset: () => setDraft(null),
  };
}

interface QuotaMutationArgs {
  save: StorageQuotaFormProps['save'];
  maxMb: number;
  usedBytes: number;
  capBytes?: number;
  onSaved: () => void;
}

/**
 * A failed save stays in `saveError` until the next save attempt. The eviction
 * note stays until the next save attempt too. Both are cleared at the start of
 * `execute`, never on input edits.
 */
function useQuotaMutation({ save, maxMb, usedBytes, capBytes, onSaved }: QuotaMutationArgs) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [evictionNote, setEvictionNote] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBytes, setPendingBytes] = useState<number | null>(null);

  const execute = async (bytes: number) => {
    setSaving(true);
    setSaveError(null);
    setEvictionNote(false);
    try {
      const outcome = await runSave(save, bytes, maxMb);
      if (outcome.ok) {
        setEvictionNote(outcome.evictionScheduled);
        onSaved();
      } else {
        setSaveError(outcome.message);
      }
    } finally {
      setSaving(false);
      // Close the confirm dialog on every attempt so an inline failure is not hidden behind it.
      setConfirmOpen(false);
    }
  };

  const request = (mb: number | null) => {
    if (mb === null) return;
    const bytes = mb * BYTES_PER_MB;
    if (!exceedsUsage(bytes, usedBytes, capBytes)) {
      void execute(bytes);
      return;
    }
    setPendingBytes(bytes);
    setConfirmOpen(true);
  };

  const confirm = () => {
    if (pendingBytes !== null) void execute(pendingBytes);
  };

  return {
    saving,
    saveError,
    evictionNote,
    confirmOpen,
    setConfirmOpen,
    pendingEffectiveBytes: pendingEffectiveFor(pendingBytes, capBytes),
    request,
    confirm,
  };
}

/** Client-side range hint: plain field text, no role. */
function QuotaRangeHint({ message }: { message: string | null }) {
  return message ? <p className="text-[11px] text-chatroom-status-error">{message}</p> : null;
}

/** A failed save: `role="alert"` beside the form. Stays until the next save attempt. */
function QuotaSaveError({ message }: { message: string | null }) {
  return (
    <InlineFeedback
      variant="text"
      feedback={message ? { id: 1, tone: 'error', message } : null}
      data-testid="quota-save-error"
    />
  );
}

/** Persistent, plain text (no role). Stays until the next save attempt. */
function QuotaEvictionNote({ visible }: { visible: boolean }) {
  return visible ? (
    <p data-testid="quota-eviction-note" className="text-[11px] text-chatroom-text-muted">
      Limit saved. Removing oldest files to fit.
    </p>
  ) : null;
}

function QuotaSaveButton({ canSave, saving }: { canSave: boolean; saving: boolean }) {
  return (
    <Button type="submit" size="sm" disabled={!canSave || saving}>
      {saving ? 'Saving…' : 'Save'}
    </Button>
  );
}

interface QuotaEditorRowProps {
  id: string;
  draftMb: string;
  maxMb: number;
  invalid: boolean;
  canSave: boolean;
  saving: boolean;
  onChange: (value: string) => void;
}

function QuotaEditorRow({
  id,
  draftMb,
  maxMb,
  invalid,
  canSave,
  saving,
  onChange,
}: QuotaEditorRowProps) {
  return (
    <>
      <Label
        htmlFor={id}
        className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted"
      >
        Storage limit (MB)
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5">
          <Input
            id={id}
            inputMode="numeric"
            value={draftMb}
            onChange={(event) => onChange(event.target.value)}
            disabled={saving}
            aria-invalid={invalid}
            className={cn(
              'h-8 w-32 rounded-none text-xs',
              invalid && 'border-chatroom-status-error'
            )}
          />
          <span className="text-xs text-chatroom-text-muted">MB</span>
        </div>
        <QuotaSaveButton canSave={canSave} saving={saving} />
        <span className="text-[11px] text-chatroom-text-muted">
          Max {maxMb} MB. 0 blocks new uploads.
        </span>
      </div>
    </>
  );
}

interface LowerLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  scopeLabel: StorageQuotaFormProps['scopeLabel'];
  usedBytes: number;
  pendingEffectiveBytes: number | null;
  onConfirm: () => void;
}

function LowerLimitDialog({
  open,
  onOpenChange,
  saving,
  scopeLabel,
  usedBytes,
  pendingEffectiveBytes,
  onConfirm,
}: LowerLimitDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Lower the limit and remove files?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingEffectiveBytes === null
              ? null
              : confirmCopy(scopeLabel, usedBytes, pendingEffectiveBytes)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={saving}
          >
            Lower limit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Shared quota editor. The parent binds `save` to the mutation for its scope.
 *
 * `draft` stays `null` while the input follows the server value, so a quota
 * change from the query repopulates the field without an effect; the first edit
 * pins the draft until a save succeeds.
 */
export function StorageQuotaForm({
  quotaBytes,
  platformMaxBytes,
  usedBytes,
  capBytes,
  scopeLabel,
  save,
}: StorageQuotaFormProps) {
  const id = useId();
  const maxMb = Math.floor(platformMaxBytes / BYTES_PER_MB);
  const { draftMb, dirty, parsedMb, edit, reset } = useQuotaDraft(quotaBytes, maxMb);
  const mutation = useQuotaMutation({
    save,
    maxMb,
    usedBytes,
    capBytes,
    onSaved: reset,
  });
  const rangeError = rangeErrorFor(dirty, parsedMb, maxMb);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.request(parsedMb);
  };

  return (
    <form className="flex flex-col gap-1.5" onSubmit={handleSubmit}>
      <QuotaEditorRow
        id={id}
        draftMb={draftMb}
        maxMb={maxMb}
        invalid={mutation.saveError !== null || rangeError !== null}
        canSave={dirty && parsedMb !== null}
        saving={mutation.saving}
        onChange={edit}
      />
      <QuotaRangeHint message={rangeError} />
      <QuotaSaveError message={mutation.saveError} />
      <QuotaEvictionNote visible={mutation.evictionNote} />
      <LowerLimitDialog
        open={mutation.confirmOpen}
        onOpenChange={mutation.setConfirmOpen}
        saving={mutation.saving}
        scopeLabel={scopeLabel}
        usedBytes={usedBytes}
        pendingEffectiveBytes={mutation.pendingEffectiveBytes}
        onConfirm={mutation.confirm}
      />
    </form>
  );
}
