'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Check, Pencil, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import { getMachineErrorCopy } from '../lib/machineErrorCopy';

export interface MachineAliasFieldProps {
  machineId: string;
  alias?: string;
  hostname: string;
  /** Smaller text for the settings-modal row. Default false (page size). */
  compact?: boolean;
  /** Increment to programmatically start editing (used by the card's "Rename" action in pass 2). Ignored while 0/undefined. */
  startEditSignal?: number;
}

const SAVE_FALLBACK_COPY = 'Could not save the name. Try again.';

const ICON_BUTTON_CLASSES =
  'flex h-8 w-8 shrink-0 items-center justify-center text-chatroom-text-muted transition-colors hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary disabled:opacity-50';

function textSizeClass(compact: boolean): string {
  return compact ? 'text-xs' : 'text-sm';
}

/** Empty input clears the alias; the backend treats undefined and '' the same. */
function aliasOrUndefined(value: string): string | undefined {
  return value || undefined;
}

/** Display mode: name plus the always-visible rename affordance. */
function MachineAliasDisplay({
  alias,
  hostname,
  compact,
  onEdit,
  attachPencil,
}: {
  alias?: string;
  hostname: string;
  compact: boolean;
  onEdit: () => void;
  attachPencil: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        data-testid="machine-name"
        className={`truncate font-bold text-chatroom-text-primary ${textSizeClass(compact)}`}
      >
        {alias || hostname}
      </span>
      <button
        ref={attachPencil}
        type="button"
        onClick={onEdit}
        title="Rename machine"
        aria-label="Rename machine"
        data-testid="machine-alias-edit"
        className={ICON_BUTTON_CLASSES}
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}

/** Edit mode: input with Save/Cancel buttons and an inline error line. */
function MachineAliasEditor({
  value,
  hostname,
  compact,
  isSaving,
  error,
  attachInput,
  onChange,
  onKeyDown,
  onSave,
  onCancel,
}: {
  value: string;
  hostname: string;
  compact: boolean;
  isSaving: boolean;
  error: string | null;
  attachInput: (node: HTMLInputElement | null) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1">
        <input
          ref={attachInput}
          type="text"
          data-testid="machine-alias-input"
          aria-label="Machine name"
          maxLength={64}
          placeholder={hostname}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={isSaving}
          className={`h-8 min-w-0 flex-1 border border-chatroom-border bg-chatroom-bg-secondary px-2 font-bold text-chatroom-text-primary outline-none focus:border-chatroom-border-strong disabled:opacity-50 ${textSizeClass(compact)}`}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSave}
          disabled={isSaving}
          aria-label="Save name"
          data-testid="machine-alias-save"
          className={ICON_BUTTON_CLASSES}
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCancel}
          disabled={isSaving}
          aria-label="Cancel rename"
          data-testid="machine-alias-cancel"
          className={ICON_BUTTON_CLASSES}
        >
          <X size={12} />
        </button>
      </div>
      {error && (
        <p
          role="alert"
          data-testid="machine-alias-error"
          className="text-xs text-chatroom-status-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Inline machine alias editor shared by the Machines page and AgentSettingsModal.
 *
 * Keyboard contract: Enter saves, Escape cancels, and blur does nothing — so a
 * stray click can neither save an accidental rename nor discard a typed one.
 */
export const MachineAliasField = memo(function MachineAliasField({
  machineId,
  alias,
  hostname,
  compact = false,
  startEditSignal,
}: MachineAliasFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(alias ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aliasRef = useRef(alias);
  const refocusPencilRef = useRef(false);

  aliasRef.current = alias;

  const setMachineAlias = useSessionMutation(api.machines.setMachineAlias);

  // Ref callbacks cover focus without effects: the input mounts only when edit
  // mode opens, and the pencil mounts only when display mode is restored.
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.select();
    }
  }, []);

  const attachPencil = useCallback((node: HTMLButtonElement | null) => {
    if (node && refocusPencilRef.current) {
      refocusPencilRef.current = false;
      node.focus();
    }
  }, []);

  const beginEdit = useCallback(() => {
    setValue(aliasRef.current ?? '');
    setError(null);
    setIsEditing(true);
  }, []);

  // External signal (e.g. the card's "Rename" action) depends only on the signal;
  // the latest alias is read through a ref to avoid re-triggering on rename.
  useEffect(() => {
    if (!startEditSignal) return;
    setValue(aliasRef.current ?? '');
    setError(null);
    setIsEditing(true);
  }, [startEditSignal]);

  const cancelEdit = useCallback(() => {
    refocusPencilRef.current = true;
    setIsEditing(false);
    setValue(aliasRef.current ?? '');
    setError(null);
  }, []);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed === (aliasRef.current ?? '')) {
      refocusPencilRef.current = true;
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await setMachineAlias({ machineId, alias: aliasOrUndefined(trimmed) });
      refocusPencilRef.current = true;
      setIsEditing(false);
    } catch (err) {
      setError(getMachineErrorCopy(err, SAVE_FALLBACK_COPY));
    } finally {
      setIsSaving(false);
    }
  }, [machineId, setMachineAlias, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    },
    [save, cancelEdit]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setError(null);
  }, []);

  if (!isEditing) {
    return (
      <MachineAliasDisplay
        alias={alias}
        hostname={hostname}
        compact={compact}
        onEdit={beginEdit}
        attachPencil={attachPencil}
      />
    );
  }

  return (
    <MachineAliasEditor
      value={value}
      hostname={hostname}
      compact={compact}
      isSaving={isSaving}
      error={error}
      attachInput={attachInput}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onSave={() => void save()}
      onCancel={cancelEdit}
    />
  );
});
