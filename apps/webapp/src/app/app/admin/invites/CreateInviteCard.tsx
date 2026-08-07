'use client';

import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/app/app/admin/convexError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type ExpiryMode = '30days' | 'indefinite';

type CreateInviteInput = {
  inviteeName: string;
  inviteeEmail: string;
  expiry: { type: 'indefinite' } | { type: 'days'; days: number };
};

type CreateInviteCardProps = {
  onCreate: (input: CreateInviteInput) => Promise<{ code: string }>;
};

export function CreateInviteCard({ onCreate }: CreateInviteCardProps) {
  const [inviteeName, setInviteeName] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('30days');
  const [isCreating, setIsCreating] = useState(false);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);

  const handleCopyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(formatLoginCode(code));
      toast.success('Invite code copied to clipboard');
    } catch (error) {
      console.error('Failed to copy invite code:', error);
      toast.error('Failed to copy invite code to clipboard');
    }
  }, []);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsCreating(true);
      try {
        const invite = await onCreate({
          inviteeName,
          inviteeEmail,
          expiry: expiryMode === 'indefinite' ? { type: 'indefinite' } : { type: 'days', days: 30 },
        });
        setInviteeName('');
        setInviteeEmail('');
        setExpiryMode('30days');
        setLastCreatedCode(invite.code);
        toast.success('Invite created');
      } catch (error) {
        toast.error(getErrorMessage(error, 'Operation failed'));
      } finally {
        setIsCreating(false);
      }
    },
    [inviteeEmail, inviteeName, expiryMode, onCreate]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Invite</CardTitle>
        <CardDescription>Generate a new invite code for a specific email address</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invitee-name">Invitee name</Label>
            <Input
              id="invitee-name"
              value={inviteeName}
              onChange={(e) => setInviteeName(e.target.value)}
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
              onChange={(e) => setInviteeEmail(e.target.value)}
              placeholder="jane@example.com"
              required
              disabled={isCreating}
            />
          </div>
          <div className="space-y-2">
            <Label>Expiry</Label>
            <RadioGroup
              value={expiryMode}
              onValueChange={(value) => setExpiryMode(value as ExpiryMode)}
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
                onClick={() => handleCopyCode(lastCreatedCode)}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
