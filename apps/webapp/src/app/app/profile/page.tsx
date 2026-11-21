'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useAction } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { Check, CopyIcon, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useCallback, useMemo, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { cn } from '@/lib/utils';
import { useAuthState } from '@/modules/auth/AuthProvider';
import { LoginCodeGenerator } from '@/modules/auth/LoginCodeGenerator';
import { NameEditForm } from '@/modules/profile/NameEditForm';
import { ThemeSettings } from '@/modules/theme/ThemeSettings';

/**
 * Displays the user profile page with account management, theme settings, and recovery options.
 */
function ProfilePageContent() {
  const authState = useAuthState();

  const isAuthenticated = useMemo(() => {
    return authState?.state === 'authenticated' && !!authState?.user;
  }, [authState]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <h1 className="text-xl font-semibold mb-2">Profile</h1>
        <p className="text-sm text-muted-foreground">
          You need to be logged in to view your profile.
        </p>
        <Link href="/login" className="mt-4">
          <Button>Log In</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Profile</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Manage your account information and preferences.
        </p>

        <div className="border-t pt-6">
          <h2 className="text-xl font-semibold mb-2">Account Information</h2>
          <div className="space-y-4">
            <NameEditForm />
            <LoginCodeGenerator />
          </div>
        </div>

        <ThemeSettings />

        <RecoveryCodeSection />
      </div>
    </div>
  );
}

/**
 * Loading state for the profile page
 */
function ProfilePageLoading() {
  return (
    <div className="container max-w-2xl mx-auto p-4">
      <div className="animate-pulse space-y-6">
        <div>
          <div className="h-8 bg-muted rounded w-32 mb-2" />
          <div className="h-4 bg-muted rounded w-64 mb-6" />
        </div>
        <div className="border-t pt-6">
          <div className="h-6 bg-muted rounded w-48 mb-4" />
          <div className="space-y-4">
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Main profile page component with Suspense boundary
 */
export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfilePageLoading />}>
      <ProfilePageContent />
    </Suspense>
  );
}

/**
 * Displays recovery code management section for account backup and restoration.
 */
function RecoveryCodeSection() {
  const getOrCreateCode = useAction(api.auth.getOrCreateRecoveryCode);
  const regenerateCode = useAction(api.auth.regenerateRecoveryCode);
  const [sessionId] = useSessionId();

  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleRevealCode = useCallback(async () => {
    await _handleRevealCode({
      sessionId,
      setError,
      setIsLoading,
      getOrCreateCode,
      setRecoveryCode,
    });
  }, [sessionId, getOrCreateCode]);

  const handleRegenerateCode = useCallback(async () => {
    await _handleRegenerateCode({
      sessionId,
      setIsRegenerating,
      setError,
      regenerateCode,
      setRecoveryCode,
      setDialogOpen,
    });
  }, [sessionId, regenerateCode]);

  const buttonText = useMemo(() => {
    return isLoading ? 'Revealing...' : 'Reveal Recovery Code';
  }, [isLoading]);

  return (
    <div className="mt-6 border-t pt-6">
      <h2 className="text-xl font-semibold mb-2">Account Recovery</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Keep this recovery code in a safe place. It's the only way to regain access to your
        anonymous account if you lose access.
      </p>
      {recoveryCode ? (
        <RecoveryCodeDisplay
          recoveryCode={recoveryCode}
          isRegenerating={isRegenerating}
          dialogOpen={dialogOpen}
          onDialogOpenChange={setDialogOpen}
          onRegenerate={handleRegenerateCode}
        />
      ) : (
        <Button onClick={handleRevealCode} disabled={isLoading}>
          {buttonText}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

interface RecoveryCodeDisplayProps {
  recoveryCode: string;
  isRegenerating: boolean;
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onRegenerate: () => void;
}

/**
 * The revealed recovery code: copy control and regenerate dialog.
 */
function RecoveryCodeDisplay({
  recoveryCode,
  isRegenerating,
  dialogOpen,
  onDialogOpenChange,
  onRegenerate,
}: RecoveryCodeDisplayProps) {
  return (
    <div className="space-y-4">
      {/* Keyed by code: a regenerated code starts with no copy feedback from the old one. */}
      <RecoveryCodeCopy key={recoveryCode} recoveryCode={recoveryCode} />

      <RegenerateRecoveryCodeDialog
        open={dialogOpen}
        onOpenChange={onDialogOpenChange}
        isRegenerating={isRegenerating}
        onRegenerate={onRegenerate}
      />
    </div>
  );
}

interface RecoveryCodeCopyProps {
  recoveryCode: string;
}

/**
 * Read-only recovery code field, copy control, and copy-failure message.
 * Owns the copy feedback state. The parent keys it by code so feedback resets on regenerate.
 */
function RecoveryCodeCopy({ recoveryCode }: RecoveryCodeCopyProps) {
  const { copiedKey, failedKey, copy } = useCopyToClipboard();

  const handleTextareaClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    // Select all text when clicked for easy copying
    e.currentTarget.select();
  }, []);

  const handleCopyCode = useCallback(() => {
    void copy(recoveryCode, 'recovery');
  }, [copy, recoveryCode]);

  return (
    <div className="flex flex-col space-y-2">
      <Textarea
        value={recoveryCode}
        readOnly
        className="font-mono text-sm whitespace-normal break-all h-auto min-h-[100px] resize-none"
        onClick={handleTextareaClick}
      />
      <CopyRecoveryCodeButton isCopied={copiedKey === 'recovery'} onCopy={handleCopyCode} />
      {failedKey === 'recovery' && (
        <p role="alert" className="self-end text-sm text-destructive">
          Failed to copy code.
        </p>
      )}
    </div>
  );
}

/**
 * Copy button for the recovery code. Shows Check + "Copied" while `isCopied`.
 */
function CopyRecoveryCodeButton({ isCopied, onCopy }: { isCopied: boolean; onCopy: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCopy}
      aria-label="Copy recovery code"
      title="Copy to clipboard"
      className="self-end"
    >
      {isCopied ? <Check className="h-4 w-4 mr-2" /> : <CopyIcon className="h-4 w-4 mr-2" />}
      {isCopied ? 'Copied' : 'Copy Code'}
    </Button>
  );
}

interface RegenerateRecoveryCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRegenerating: boolean;
  onRegenerate: () => void;
}

/**
 * Confirmation dialog for regenerating the recovery code (invalidates the old one).
 */
function RegenerateRecoveryCodeDialog({
  open,
  onOpenChange,
  isRegenerating,
  onRegenerate,
}: RegenerateRecoveryCodeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger
        className={cn(buttonVariants({ variant: 'outline' }), 'flex items-center gap-2')}
        disabled={isRegenerating}
      >
        <RefreshCw className="h-4 w-4" />
        {isRegenerating ? 'Regenerating...' : 'Regenerate Code'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            Regenerating your recovery code will{' '}
            <span className="font-bold text-destructive">invalidate your old code</span>. This
            action cannot be undone. Your old recovery code will no longer work!
            <br />
            <br />
            Make sure to save your new code in a secure location after regenerating.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onRegenerate}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            Regenerate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface _RevealCodeParams {
  sessionId: ReturnType<typeof useSessionId>[0];
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  getOrCreateCode: ReturnType<typeof useAction<typeof api.auth.getOrCreateRecoveryCode>>;
  setRecoveryCode: (code: string | null) => void;
}

/**
 * Handles revealing the recovery code with proper error handling and loading states.
 */
async function _handleRevealCode(params: _RevealCodeParams): Promise<void> {
  const { sessionId, setError, setIsLoading, getOrCreateCode, setRecoveryCode } = params;

  if (!sessionId) {
    setError('Session not found. Cannot fetch recovery code.');
    return;
  }

  setIsLoading(true);
  setError(null);

  try {
    const result = await getOrCreateCode({ sessionId });
    if (result.success && result.recoveryCode) {
      setRecoveryCode(result.recoveryCode);
    } else {
      setError(result.reason || 'Failed to retrieve recovery code.');
    }
  } catch (error) {
    console.error('Error revealing recovery code:', error);
    setError('An unexpected error occurred.');
  } finally {
    setIsLoading(false);
  }
}

interface _RegenerateCodeParams {
  sessionId: ReturnType<typeof useSessionId>[0];
  setIsRegenerating: (regenerating: boolean) => void;
  setError: (error: string | null) => void;
  regenerateCode: ReturnType<typeof useAction<typeof api.auth.regenerateRecoveryCode>>;
  setRecoveryCode: (code: string | null) => void;
  setDialogOpen: (open: boolean) => void;
}

/**
 * Handles regenerating the recovery code with confirmation and error handling.
 */
async function _handleRegenerateCode(params: _RegenerateCodeParams): Promise<void> {
  const { sessionId, setIsRegenerating, setError, regenerateCode, setRecoveryCode, setDialogOpen } =
    params;

  if (!sessionId) {
    setError('Session not found. Cannot regenerate recovery code.');
    return;
  }

  setIsRegenerating(true);
  setError(null);

  try {
    const result = await regenerateCode({ sessionId });
    if (result.success && result.recoveryCode) {
      setRecoveryCode(result.recoveryCode);
    } else {
      setError(result.reason || 'Failed to regenerate recovery code.');
    }
  } catch (error) {
    console.error('Error regenerating recovery code:', error);
    setError('An unexpected error occurred.');
  } finally {
    setIsRegenerating(false);
    setDialogOpen(false);
  }
}
