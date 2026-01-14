'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { AlertCircle, Check, Loader2, Monitor, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * CLI Auth page - approves CLI device authorization requests
 */

// Type assertion for CLI auth API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliAuthApi = api as any;

interface AuthRequestDetails {
  found: boolean;
  status?: string;
  deviceName?: string;
  cliVersion?: string;
  createdAt?: number;
  expiresAt?: number;
  isExpired?: boolean;
}

function CliAuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authState = useAuthState();
  const requestId = searchParams.get('request');

  const [actionState, setActionState] = useState<'idle' | 'approving' | 'denying' | 'done'>('idle');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Get session ID from localStorage
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    setSessionId(localStorage.getItem('sessionId'));
  }, []);

  // Query auth request details
  const requestDetails = useQuery(
    cliAuthApi.cliAuth?.getAuthRequestDetails,
    requestId ? { requestId } : 'skip'
  ) as AuthRequestDetails | undefined;

  // Mutations
  const approveRequest = useMutation(cliAuthApi.cliAuth?.approveAuthRequest);
  const denyRequest = useMutation(cliAuthApi.cliAuth?.denyAuthRequest);

  const handleApprove = useCallback(async () => {
    if (!requestId || !sessionId) return;

    setActionState('approving');
    try {
      const result = await approveRequest({ requestId, sessionId });
      if (result.success) {
        setResult({
          success: true,
          message: 'CLI authorized successfully! You can close this window.',
        });
      } else {
        setResult({ success: false, message: result.error || 'Failed to approve request' });
      }
    } catch (error) {
      const err = error as Error;
      setResult({ success: false, message: err.message });
    }
    setActionState('done');
  }, [requestId, sessionId, approveRequest]);

  const handleDeny = useCallback(async () => {
    if (!requestId || !sessionId) return;

    setActionState('denying');
    try {
      const result = await denyRequest({ requestId, sessionId });
      if (result.success) {
        setResult({ success: true, message: 'CLI authorization denied.' });
      } else {
        setResult({ success: false, message: result.error || 'Failed to deny request' });
      }
    } catch (error) {
      const err = error as Error;
      setResult({ success: false, message: err.message });
    }
    setActionState('done');
  }, [requestId, sessionId, denyRequest]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (authState?.state === 'unauthenticated' && requestId) {
      // Redirect to login with return URL
      router.push(`/login?redirect=${encodeURIComponent(`/cli-auth?request=${requestId}`)}`);
    }
  }, [authState, requestId, router]);

  // Loading state
  if (authState === undefined || requestDetails === undefined) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </main>
    );
  }

  // No request ID
  if (!requestId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8 shadow-sm text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Missing Request ID</h1>
            <p className="text-muted-foreground">
              No authorization request specified. Please use the link from your CLI.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Request not found
  if (!requestDetails.found) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8 shadow-sm text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h1 className="text-xl font-semibold">Request Not Found</h1>
            <p className="text-muted-foreground">
              This authorization request doesn't exist or has already been processed.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Request expired
  if (requestDetails.isExpired || requestDetails.status === 'expired') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8 shadow-sm text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Request Expired</h1>
            <p className="text-muted-foreground">
              This authorization request has expired. Please run{' '}
              <code className="bg-muted px-1 rounded">chatroom auth login</code> again.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Already processed
  if (requestDetails.status !== 'pending') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8 shadow-sm text-center space-y-4">
            {requestDetails.status === 'approved' ? (
              <>
                <Check className="mx-auto h-12 w-12 text-green-500" />
                <h1 className="text-xl font-semibold">Already Approved</h1>
                <p className="text-muted-foreground">
                  This authorization request has already been approved.
                </p>
              </>
            ) : (
              <>
                <X className="mx-auto h-12 w-12 text-destructive" />
                <h1 className="text-xl font-semibold">Already Denied</h1>
                <p className="text-muted-foreground">This authorization request was denied.</p>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Show result
  if (result) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8 shadow-sm text-center space-y-4">
            {result.success ? (
              <Check className="mx-auto h-12 w-12 text-green-500" />
            ) : (
              <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            )}
            <h1 className="text-xl font-semibold">{result.success ? 'Done!' : 'Error'}</h1>
            <p className="text-muted-foreground">{result.message}</p>
          </div>
        </div>
      </main>
    );
  }

  // Pending - show approval UI
  const timeRemaining = requestDetails.expiresAt
    ? Math.max(0, Math.round((requestDetails.expiresAt - Date.now()) / 1000))
    : 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Authorize CLI</h1>
          <p className="text-sm text-muted-foreground">
            A CLI tool is requesting access to your account
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm space-y-6">
          {/* Device Info */}
          <div className="flex items-start gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <Monitor className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="font-medium">Device Details</h3>
              <p className="text-sm text-muted-foreground">
                {requestDetails.deviceName || 'Unknown Device'}
              </p>
              {requestDetails.cliVersion && (
                <p className="text-xs text-muted-foreground">
                  CLI Version: {requestDetails.cliVersion}
                </p>
              )}
            </div>
          </div>

          {/* Time remaining */}
          <div className="text-center text-sm text-muted-foreground">
            Request expires in {Math.floor(timeRemaining / 60)}:
            {String(timeRemaining % 60).padStart(2, '0')}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDeny}
              disabled={actionState !== 'idle'}
            >
              {actionState === 'denying' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              Deny
            </Button>
            <Button className="flex-1" onClick={handleApprove} disabled={actionState !== 'idle'}>
              {actionState === 'approving' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Approve
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Only approve if you initiated this request from your CLI.
        </p>
      </div>
    </main>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </main>
      }
    >
      <CliAuthContent />
    </Suspense>
  );
}
