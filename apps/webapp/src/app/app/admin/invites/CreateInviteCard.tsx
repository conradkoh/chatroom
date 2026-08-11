'use client';

import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/app/app/admin/convexError';
import { CreateInviteForm, type ExpiryMode } from '@/app/app/admin/invites/CreateInviteForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/useIsMobile';

export type CreateInviteInput = {
  inviteeName: string;
  inviteeEmail: string;
  expiry: { type: 'indefinite' } | { type: 'days'; days: number };
};

type CreateInviteCardProps = {
  onCreate: (input: CreateInviteInput) => Promise<{ code: string }>;
};

export function CreateInviteCard({ onCreate }: CreateInviteCardProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('30days');
  const [isCreating, setIsCreating] = useState(false);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isCreating && !nextOpen) return;
    setOpen(nextOpen);
  };

  const handleCopyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(formatLoginCode(code));
      toast.success('Invite code copied to clipboard');
    } catch (error) {
      console.error('Failed to copy invite code:', error);
      toast.error('Failed to copy invite code to clipboard');
    }
  }, []);

  const handleSubmit = useCallback(
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

  const form = (
    <CreateInviteForm
      inviteeName={inviteeName}
      inviteeEmail={inviteeEmail}
      expiryMode={expiryMode}
      isCreating={isCreating}
      lastCreatedCode={lastCreatedCode}
      onInviteeNameChange={setInviteeName}
      onInviteeEmailChange={setInviteeEmail}
      onExpiryModeChange={setExpiryMode}
      onSubmit={handleSubmit}
      onCopyCode={handleCopyCode}
    />
  );

  const triggerButton = (
    <Button className="w-full md:w-auto">
      <Plus className="mr-2 h-4 w-4" />
      Create invite
    </Button>
  );

  const title = 'Create Invite';
  const description = 'Generate a new invite code for a specific email address';

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger render={triggerButton} />
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">{form}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={triggerButton} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
