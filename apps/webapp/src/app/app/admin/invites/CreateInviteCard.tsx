'use client';

import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CreateInviteForm, type ExpiryMode } from '@/app/app/admin/invites/CreateInviteForm';
import { InlineFeedback } from '@/components/inline-feedback';
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
import { useFeedback } from '@/hooks/useFeedback';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getErrorMessage } from '@/lib/convexError';

export type CreateInviteInput = {
  inviteeName: string;
  inviteeEmail: string;
  expiry: { type: 'indefinite' } | { type: 'days'; days: number };
};

type CreateInviteCardProps = {
  onCreate: (input: CreateInviteInput) => Promise<{ code: string }>;
};

const COPY_FLIP_MS = 2000;

export function CreateInviteCard({ onCreate }: CreateInviteCardProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('30days');
  const [isCreating, setIsCreating] = useState(false);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { feedback, error, clear } = useFeedback();

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isCreating && !nextOpen) return;
    if (!nextOpen) clear();
    setOpen(nextOpen);
  };

  const handleCopyCode = useCallback(
    async (code: string) => {
      clear();
      try {
        await navigator.clipboard.writeText(formatLoginCode(code));
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        setIsCopied(true);
        copiedTimer.current = setTimeout(() => setIsCopied(false), COPY_FLIP_MS);
      } catch (copyError) {
        console.error('Failed to copy invite code:', copyError);
        error('Failed to copy invite code to clipboard');
      }
    },
    [clear, error]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      clear();
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
      } catch (submitError) {
        error(getErrorMessage(submitError, 'Operation failed'));
      } finally {
        setIsCreating(false);
      }
    },
    [inviteeEmail, inviteeName, expiryMode, onCreate, clear, error]
  );

  const feedbackSlot = (
    <InlineFeedback
      feedback={feedback}
      onDismiss={clear}
      data-testid="invite-create-feedback"
      className="mt-4"
    />
  );

  const form = (
    <>
      <CreateInviteForm
        inviteeName={inviteeName}
        inviteeEmail={inviteeEmail}
        expiryMode={expiryMode}
        isCreating={isCreating}
        isCopied={isCopied}
        lastCreatedCode={lastCreatedCode}
        onInviteeNameChange={(value) => {
          clear();
          setInviteeName(value);
        }}
        onInviteeEmailChange={(value) => {
          clear();
          setInviteeEmail(value);
        }}
        onExpiryModeChange={setExpiryMode}
        onSubmit={handleSubmit}
        onCopyCode={handleCopyCode}
      />
      {feedbackSlot}
    </>
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
