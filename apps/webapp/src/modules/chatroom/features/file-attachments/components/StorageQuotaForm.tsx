'use client';

// fallow-ignore-file unused-file

import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { toast } from 'sonner';

import { getFileAttachmentErrorMessage, isQuotaFieldError } from '../lib/fileAttachmentErrors';
import { BYTES_PER_MB, formatFileSize } from '../lib/formatFileSize';

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

function fieldErrorFor(serverError: string | null, rangeError: string | null): string | null {
  return serverError ?? rangeError;
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
  return `This ${scopeLabel} uses ${formatFileSize(usedBytes)}. The new limit is ${formatFileSize(effectiveBytes)}, so at least ${formatFileSize(removedBytes)} of the oldest files will be removed in the background. Files still uploading are kept.`;
}

interface RunSaveArgs {
  bytes: number;
  maxMb: number;
  save: StorageQuotaFormProps['save'];
  onSaved: () => void;
  onFieldError: (message: string) => void;
}

/** Runs the mutation and routes a quota validation error back to the field. */
async function runSave({ bytes, maxMb, save, onSaved, onFieldError }: RunSaveArgs): Promise<void> {
  try {
    const result = await save(bytes);
    if (result.evictionScheduled) {
      toast('Limit saved. Removing oldest files to fit.');
    } else {
      toast.success('Storage limit saved');
    }
    onSaved();
  } catch (err) {
    if (isQuotaFieldError(err)) {
      onFieldError(errorMessageOf(err, maxMb));
    } else {
      toast.error(getFileAttachmentErrorMessage(err));
    }
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

function useQuotaMutation({ save, maxMb, usedBytes, capBytes, onSaved }: QuotaMutationArgs) {
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBytes, setPendingBytes] = useState<number | null>(null);

  const execute = async (bytes: number) => {
    setSaving(true);
    setServerError(null);
    try {
      await runSave({ bytes, maxMb, save, onSaved, onFieldError: setServerError });
    } finally {
      setSaving(false);
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
    serverError,
    clearServerError: () => setServerError(null),
    confirmOpen,
    setConfirmOpen,
    pendingEffectiveBytes: pendingEffectiveFor(pendingBytes, capBytes),
    request,
    confirm,
  };
}

function QuotaFieldError({ message }: { message: string | null }) {
  return message ? <p className="text-[11px] text-chatroom-status-error">{message}</p> : null;
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
  fieldError: string | null;
  canSave: boolean;
  saving: boolean;
  onChange: (value: string) => void;
}

function QuotaEditorRow({
  id,
  draftMb,
  maxMb,
  fieldError,
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
            aria-invalid={!!fieldError}
            className={cn(
              'h-8 w-32 rounded-none text-xs',
              fieldError && 'border-chatroom-status-error'
            )}
          />
          <span className="text-xs text-chatroom-text-muted">MB</span>
        </div>
        <QuotaSaveButton canSave={canSave} saving={saving} />
        <span className="text-[11px] text-chatroom-text-muted">
          Max {maxMb} MB. 0 blocks new uploads.
        </span>
      </div>
      <QuotaFieldError message={fieldError} />
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
// fallow-ignore-next-line unused-export
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
  const fieldError = fieldErrorFor(mutation.serverError, rangeErrorFor(dirty, parsedMb, maxMb));

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
        fieldError={fieldError}
        canSave={dirty && parsedMb !== null}
        saving={mutation.saving}
        onChange={(value) => {
          edit(value);
          mutation.clearServerError();
        }}
      />
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
