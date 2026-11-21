'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useAction } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { Check, CopyIcon, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useFeedback, type UseFeedbackResult } from '@/hooks/useFeedback';
import { cn } from '@/lib/utils';

type RecoverySlot = Pick<UseFeedbackResult, 'show' | 'error' | 'clear'>;

/**
 * Displays recovery code management section for account backup and restoration.
 */
export function RecoveryCodeSection() {
  const getOrCreateCode = useAction(api.auth.getOrCreateRecoveryCode);
  const regenerateCode = useAction(api.auth.regenerateRecoveryCode);
  const [sessionId] = useSessionId();

  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { feedback, show, error, clear } = useFeedback();
  const slot = useMemo<RecoverySlot>(() => ({ show, error, clear }), [show, error, clear]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleRevealCode = useCallback(async () => {
    await _handleRevealCode({
      sessionId,
      slot,
      setIsLoading,
      getOrCreateCode,
      setRecoveryCode,
    });
  }, [sessionId, slot, getOrCreateCode]);

  const handleRegenerateCode = useCallback(async () => {
    await _handleRegenerateCode({
      sessionId,
      slot,
      setIsRegenerating,
      regenerateCode,
      setRecoveryCode,
      setDialogOpen,
    });
  }, [sessionId, slot, regenerateCode]);

  const handleCopyCode = useCallback(async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      setIsCopied(true);
      copiedTimer.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (copyError) {
      console.error('Failed to copy text: ', copyError);
      error('Failed to copy code.');
    }
  }, [recoveryCode, error]);

  const handleTextareaClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    // Select all text when clicked for easy copying
    e.currentTarget.select();
  }, []);

  const buttonText = useMemo(() => {
    return isLoading ? 'Revealing...' : 'Reveal Recovery Code';
  }, [isLoading]);

  const regenerateButtonText = useMemo(() => {
    return isRegenerating ? 'Regenerating...' : 'Regenerate Code';
  }, [isRegenerating]);

  return (
    <div className="mt-6 border-t pt-6">
      <h2 className="text-xl font-semibold mb-2">Account Recovery</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Keep this recovery code in a safe place. It's the only way to regain access to your
        anonymous account if you lose access.
      </p>
      {!recoveryCode ? (
        <Button onClick={handleRevealCode} disabled={isLoading}>
          {buttonText}
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col space-y-2">
            <Textarea
              value={recoveryCode}
              readOnly
              className="font-mono text-sm whitespace-normal break-all h-auto min-h-[100px] resize-none"
              onClick={handleTextareaClick}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyCode}
              aria-label="Copy recovery code"
              title="Copy to clipboard"
              className="self-end"
            >
              {isCopied ? (
                <Check className="h-4 w-4 mr-2" />
              ) : (
                <CopyIcon className="h-4 w-4 mr-2" />
              )}
              Copy Code
            </Button>
          </div>

          <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogTrigger
              className={cn(buttonVariants({ variant: 'outline' }), 'flex items-center gap-2')}
              disabled={isRegenerating}
            >
              <RefreshCw className="h-4 w-4" />
              {regenerateButtonText}
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
                  onClick={handleRegenerateCode}
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                >
                  Regenerate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      <InlineFeedback
        feedback={feedback}
        onDismiss={clear}
        className="mt-3"
        data-testid="recovery-feedback"
      />
    </div>
  );
}

interface _RevealCodeParams {
  sessionId: ReturnType<typeof useSessionId>[0];
  slot: RecoverySlot;
  setIsLoading: (loading: boolean) => void;
  getOrCreateCode: ReturnType<typeof useAction<typeof api.auth.getOrCreateRecoveryCode>>;
  setRecoveryCode: (code: string | null) => void;
}

/**
 * Handles revealing the recovery code with proper error handling and loading states.
 */
async function _handleRevealCode(params: _RevealCodeParams): Promise<void> {
  const { sessionId, slot, setIsLoading, getOrCreateCode, setRecoveryCode } = params;

  slot.clear();

  if (!sessionId) {
    slot.error('Session not found. Cannot fetch recovery code.');
    return;
  }

  setIsLoading(true);

  try {
    const result = await getOrCreateCode({ sessionId });
    if (result.success && result.recoveryCode) {
      setRecoveryCode(result.recoveryCode);
    } else {
      slot.error(result.reason || 'Failed to retrieve recovery code.');
    }
  } catch (error) {
    console.error('Error revealing recovery code:', error);
    slot.error('An unexpected error occurred.');
  } finally {
    setIsLoading(false);
  }
}

interface _RegenerateCodeParams {
  sessionId: ReturnType<typeof useSessionId>[0];
  slot: RecoverySlot;
  setIsRegenerating: (regenerating: boolean) => void;
  regenerateCode: ReturnType<typeof useAction<typeof api.auth.regenerateRecoveryCode>>;
  setRecoveryCode: (code: string | null) => void;
  setDialogOpen: (open: boolean) => void;
}

/**
 * Handles regenerating the recovery code with confirmation and error handling.
 */
async function _handleRegenerateCode(params: _RegenerateCodeParams): Promise<void> {
  const { sessionId, slot, setIsRegenerating, regenerateCode, setRecoveryCode, setDialogOpen } =
    params;

  slot.clear();

  if (!sessionId) {
    slot.error('Session not found. Cannot regenerate recovery code.');
    return;
  }

  setIsRegenerating(true);

  try {
    const result = await regenerateCode({ sessionId });
    if (result.success && result.recoveryCode) {
      setRecoveryCode(result.recoveryCode);
      slot.show('success', 'Recovery code regenerated successfully!');
    } else {
      slot.error(result.reason || 'Failed to regenerate recovery code.');
    }
  } catch (error) {
    console.error('Error regenerating recovery code:', error);
    slot.error('An unexpected error occurred.');
  } finally {
    setIsRegenerating(false);
    setDialogOpen(false);
  }
}
