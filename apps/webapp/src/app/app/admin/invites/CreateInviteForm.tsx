'use client';

import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type ExpiryMode = '30days' | 'indefinite';

export type InviteCopyState = 'idle' | 'copied' | 'failed';

export type CreateInviteFormProps = {
  inviteeName: string;
  inviteeEmail: string;
  expiryMode: ExpiryMode;
  isCreating: boolean;
  lastCreatedCode: string | null;
  /** Create failure message, rendered above the submit button. */
  error: string | null;
  /** Copy state for the created code. */
  copyState: InviteCopyState;
  onInviteeNameChange: (value: string) => void;
  onInviteeEmailChange: (value: string) => void;
  onExpiryModeChange: (value: ExpiryMode) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCopyCode: (code: string) => void;
};

/**
 * Invite creation form with the created-code panel. The branches only select which
 * prescribed inline slot renders (create error above submit, copy failure under the
 * code row) and the copy confirmation swap; every branch is covered by
 * `CreateInviteCard.test.tsx`.
 */
export function CreateInviteForm({
  inviteeName,
  inviteeEmail,
  expiryMode,
  isCreating,
  lastCreatedCode,
  error,
  copyState,
  onInviteeNameChange,
  onInviteeEmailChange,
  onExpiryModeChange,
  onSubmit,
  onCopyCode,
}: CreateInviteFormProps) {
  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invitee-name">Invitee name</Label>
          <Input
            id="invitee-name"
            value={inviteeName}
            onChange={(e) => onInviteeNameChange(e.target.value)}
            placeholder="Jane Doe"
            required
            disabled={isCreating}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invitee-email">Invitee email</Label>
          <Input
            id="invitee-email"
            type="email"
            value={inviteeEmail}
            onChange={(e) => onInviteeEmailChange(e.target.value)}
            placeholder="jane@example.com"
            required
            disabled={isCreating}
          />
        </div>
        <div className="space-y-2">
          <Label>Expiry</Label>
          <RadioGroup
            value={expiryMode}
            onValueChange={(value) => onExpiryModeChange(value as ExpiryMode)}
            className="grid gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="30days" id="expiry-30days" disabled={isCreating} />
              <Label htmlFor="expiry-30days" className="font-normal">
                30 days
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="indefinite" id="expiry-indefinite" disabled={isCreating} />
              <Label htmlFor="expiry-indefinite" className="font-normal">
                Indefinite
              </Label>
            </div>
          </RadioGroup>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create invite'}
        </Button>
      </form>

      {lastCreatedCode && (
        <CreatedInviteCodePanel
          code={lastCreatedCode}
          copyState={copyState}
          onCopyCode={onCopyCode}
        />
      )}
    </>
  );
}

type CreatedInviteCodePanelProps = {
  code: string;
  copyState: InviteCopyState;
  onCopyCode: (code: string) => void;
};

/**
 * Created-code panel: formatted invite code, copy control with copied swap, and the
 * inline copy failure message under the code row.
 */
function CreatedInviteCodePanel({ code, copyState, onCopyCode }: CreatedInviteCodePanelProps) {
  return (
    <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <p className="text-sm font-medium">Invite code created</p>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-2xl font-bold tracking-wider">{formatLoginCode(code)}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onCopyCode(code)}>
          {copyState === 'copied' ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copyState === 'failed' && (
        <p role="alert" className="text-xs text-destructive">
          Failed to copy invite code to clipboard
        </p>
      )}
    </div>
  );
}
