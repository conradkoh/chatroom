'use client';

import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type ExpiryMode = '30days' | 'indefinite';

export type CreateInviteFormProps = {
  inviteeName: string;
  inviteeEmail: string;
  expiryMode: ExpiryMode;
  isCreating: boolean;
  lastCreatedCode: string | null;
  onInviteeNameChange: (value: string) => void;
  onInviteeEmailChange: (value: string) => void;
  onExpiryModeChange: (value: ExpiryMode) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCopyCode: (code: string) => void;
};

export function CreateInviteForm({
  inviteeName,
  inviteeEmail,
  expiryMode,
  isCreating,
  lastCreatedCode,
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
        <Button type="submit" disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create invite'}
        </Button>
      </form>

      {lastCreatedCode && (
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <p className="text-sm font-medium">Invite code created</p>
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-2xl font-bold tracking-wider">
              {formatLoginCode(lastCreatedCode)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCopyCode(lastCreatedCode)}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
