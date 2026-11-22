'use client';

/**
 * Inline editor for an integration's optional name and description.
 *
 * Drafts are local until Save; only fields whose normalised value differs from
 * the stored value are sent. Emptying a field sends `''`, which the backend
 * maps to "remove the key". `config` is never included.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';

import { IntegrationDetailFields, evaluateIntegrationDetails } from './IntegrationDetailFields';
import { integrationErrorMessage } from './integrationErrorMessage';

import { Button } from '@/components/ui/button';

type IntegrationListItem = FunctionReturnType<typeof api.integrations.list>[number];

export interface IntegrationDetailsEditorProps {
  integration: IntegrationListItem;
  /** Cancel, the X button, and a successful save all close the panel. */
  onClose: () => void;
}

export function IntegrationDetailsEditor({ integration, onClose }: IntegrationDetailsEditorProps) {
  const updateIntegration = useSessionMutation(api.integrations.update);
  const [nameDraft, setNameDraft] = useState(integration.name ?? '');
  const [descDraft, setDescDraft] = useState(integration.description ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const r = evaluateIntegrationDetails(nameDraft, descDraft);
  const nameChanged = r.name.ok && r.name.value !== integration.name;
  const descChanged = r.description.ok && r.description.value !== integration.description;
  const canSave = r.valid && (nameChanged || descChanged) && !isSaving;

  const handleNameChange = (v: string) => {
    setNameDraft(v);
    setSaveError(null);
  };

  const handleDescriptionChange = (v: string) => {
    setDescDraft(v);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!canSave) return;

    setSaveError(null);
    setIsSaving(true);
    try {
      await updateIntegration({
        integrationId: integration._id,
        ...(nameChanged ? { name: r.name.ok ? (r.name.value ?? '') : '' } : {}),
        ...(descChanged
          ? { description: r.description.ok ? (r.description.value ?? '') : '' }
          : {}),
      });
      onClose();
      return;
    } catch (err) {
      setSaveError(integrationErrorMessage(err));
    }
    setIsSaving(false);
  };

  return (
    <div className="space-y-3 border-t border-chatroom-border bg-chatroom-bg-primary/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
          Edit Details
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isSaving}
          aria-label="Close edit details"
          className="h-6 w-6 p-0 text-chatroom-text-muted"
        >
          <X size={12} />
        </Button>
      </div>
      <p className="text-[11px] text-chatroom-text-muted">Leave a field empty to remove it.</p>
      <IntegrationDetailFields
        idPrefix={`integ-${integration._id}`}
        name={nameDraft}
        description={descDraft}
        onNameChange={handleNameChange}
        onDescriptionChange={handleDescriptionChange}
        disabled={isSaving}
        showClearHints
        hadName={!!integration.name}
        hadDescription={!!integration.description}
        onNameEnter={handleSave}
      />
      {saveError && (
        <p role="alert" className="text-xs text-chatroom-status-error">
          {saveError}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={isSaving}
          className="w-full text-xs sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          className="w-full gap-1.5 text-xs sm:w-auto"
        >
          {isSaving ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </div>
    </div>
  );
}
