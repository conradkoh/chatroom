'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import {
  useSessionAction,
  useSessionMutation,
  useSessionQuery,
} from 'convex-helpers/react/sessions';
import {
  AlertCircle,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  TestTube,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useAppInfo } from '@/modules/app/useAppInfo';

type ActionResult = { variant: 'default' | 'destructive'; message: string };
type FieldErrors = { clientId?: string; clientSecret?: string; redirectUris?: string };

/**
 * Displays Google Authentication configuration page with OAuth setup, testing, and management capabilities.
 */
export default function GoogleAuthConfigPage() {
  const { isLoading: appInfoLoading } = useAppInfo();

  // State for form inputs
  const [enabled, setEnabled] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [isFormLoading, setIsFormLoading] = useState(false);
  const [clientSecretFocused, setClientSecretFocused] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Convex queries and mutations
  const configData = useSessionQuery(api.system.auth.google.getConfig);
  const updateConfig = useSessionMutation(api.system.auth.google.updateConfig);
  const toggleEnabled = useSessionMutation(api.system.auth.google.toggleEnabled);
  const testConfig = useSessionAction(api.system.auth.google.testConfig);
  const resetConfig = useSessionMutation(api.system.auth.google.resetConfig);
  const { copiedKey, failedKey, copy } = useCopyToClipboard();

  // Computed values - generate redirect URIs on frontend
  const redirectUris = useMemo(() => {
    if (typeof window === 'undefined') return [];
    return [`${window.location.origin}/api/auth/google/callback`];
  }, []);
  const javascriptOrigins = useMemo(() => {
    if (typeof window === 'undefined') return [];
    return [window.location.origin];
  }, []);
  const isConfigLoading = configData === undefined;
  const isPageLoading = appInfoLoading || isConfigLoading;
  const clientSecretDisplayValue = useMemo(
    () => _getClientSecretDisplayValue(configData || undefined, clientSecretFocused, clientSecret),
    [configData, clientSecretFocused, clientSecret]
  );
  const googleCloudLinks = useMemo(() => _getGoogleCloudLinks(projectId), [projectId]);

  // Load existing configuration
  useEffect(() => {
    if (configData) {
      setEnabled(configData.enabled);
      setProjectId(configData.projectId || '');
      setClientId(configData.clientId || '');
      setClientSecret(''); // Never load the actual secret for security
      setIsConfigured(configData.isConfigured);
    }
  }, [configData]);

  // Event handlers
  const handleClientSecretFocus = useCallback(() => {
    _handleClientSecretFocus(setClientSecretFocused);
  }, []);

  const handleClientSecretBlur = useCallback(() => {
    _handleClientSecretBlur(setClientSecretFocused);
  }, []);

  const handleToggleEnabled = useCallback(
    async (newEnabled: boolean) => {
      await _handleToggleEnabled(newEnabled, toggleEnabled, setEnabled, setToggleError);
    },
    [toggleEnabled]
  );

  const handleSave = useCallback(async () => {
    await _handleSave({
      isFormLoading,
      setIsFormLoading,
      redirectUris,
      projectId,
      clientId,
      clientSecret,
      configData: configData || undefined,
      enabled,
      updateConfig,
      setIsConfigured,
      setFieldErrors,
      setActionResult,
    });
  }, [
    isFormLoading,
    redirectUris,
    projectId,
    clientId,
    clientSecret,
    configData,
    enabled,
    updateConfig,
  ]);

  const handleTest = useCallback(async () => {
    await _handleTest({
      clientId,
      clientSecret,
      testConfig,
      setFieldErrors,
      setActionResult,
      setIsTesting,
    });
  }, [clientId, clientSecret, testConfig]);

  const handleReset = useCallback(async () => {
    await _handleReset({
      resetConfig,
      setProjectId,
      setClientId,
      setClientSecret,
      setIsConfigured,
      setFieldErrors,
      setActionResult,
    });
  }, [resetConfig]);

  const handleCopy = useCallback(
    (text: string) => {
      void copy(text, text);
    },
    [copy]
  );

  // Show loading state while data is being fetched
  if (isPageLoading) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Google Authentication Configuration</h1>
          <p className="text-muted-foreground">Configure Google OAuth for user authentication</p>
        </div>

        {/* Enable/Disable Control Skeleton */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-64" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-96" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-6 w-11" />
            </div>
          </CardContent>
        </Card>

        {/* Status Overview Skeleton */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-48" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-80" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Form Skeleton */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-56" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-72" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Project ID Skeleton */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-96" />
            </div>

            {/* Client ID Skeleton */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-80" />
            </div>

            {/* Client Secret Skeleton */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-36" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-96" />
            </div>

            <Separator />

            {/* Redirect URIs Skeleton */}
            <div className="space-y-4">
              <div>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full mt-1" />
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 w-16" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 w-16" />
                </div>
              </div>
            </div>

            <Separator />

            {/* Action Buttons Skeleton */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-36" />
              <Skeleton className="h-10 w-32" />
            </div>
          </CardContent>
        </Card>

        {/* Setup Instructions Skeleton */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-40" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-64" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i}>
                  <Skeleton className="h-5 w-48 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2 pt-6">
        <h1 className="text-3xl font-bold">Google Authentication Configuration</h1>
        <p className="text-muted-foreground">Configure Google OAuth for user authentication</p>
      </div>

      {/* Enable/Disable Control */}
      <Card>
        <CardHeader>
          <CardTitle>Google Authentication Control</CardTitle>
          <CardDescription>Enable or disable Google Authentication for your users</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="google-auth-enabled" className="text-base font-medium">
                Google Authentication
              </Label>
              <p className="text-sm text-muted-foreground">
                {enabled ? 'Users can sign in with Google' : 'Google sign-in is disabled'}
              </p>
            </div>
            <Switch
              id="google-auth-enabled"
              checked={enabled}
              onCheckedChange={handleToggleEnabled}
            />
          </div>
          {toggleError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {toggleError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Status Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Status</CardTitle>
          <CardDescription>Current state of Google Authentication setup</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Overall Status</span>
              <div className="flex items-center gap-2">
                {enabled && isConfigured ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-600">Ready</span>
                  </>
                ) : !enabled && isConfigured ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Disabled</span>
                  </>
                ) : enabled && !isConfigured ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-600">Setup Required</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      Not Configured
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">Configuration Status</span>
              <div className="flex items-center gap-2">
                {isConfigured ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-600">Configured</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span className="text-sm text-red-600">Not Configured</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Form */}
      <Card>
        <CardHeader>
          <CardTitle>Google Cloud Console Setup</CardTitle>
          <CardDescription>Configure your Google OAuth application settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Project ID */}
          <div className="space-y-2">
            <Label htmlFor="projectId">Google Cloud Project ID (Optional)</Label>
            <Input
              id="projectId"
              placeholder="e.g., my-awesome-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setActionResult(null);
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Optional: Provides project-specific links to Google Cloud Console
              </p>
              <Link
                href={googleCloudLinks.console}
                target="_blank"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                Open Console
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* Client ID */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="clientId">Google Client ID</Label>
              <Link
                href={googleCloudLinks.credentials}
                target="_blank"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                Manage Credentials
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <Input
              id="clientId"
              placeholder="e.g., 123456789012-abcdefghijklmnop.apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setFieldErrors((prev) => ({ ...prev, clientId: undefined }));
                setActionResult(null);
              }}
              className={_getClientIdValidationClass(clientId)}
              aria-invalid={fieldErrors.clientId ? true : undefined}
              aria-describedby={fieldErrors.clientId ? 'clientId-error' : undefined}
            />
            {_renderClientIdValidation(clientId, fieldErrors.clientId)}
          </div>

          {/* Client Secret */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="clientSecret">Google Client Secret</Label>
              {configData && (
                <div className="flex items-center gap-2">
                  {configData.hasClientSecret ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-xs text-green-600 font-medium">Configured</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-amber-600" />
                      <span className="text-xs text-amber-600 font-medium">Not Set</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <Input
                id="clientSecret"
                type={showClientSecret ? 'text' : 'password'}
                placeholder={
                  configData?.hasClientSecret
                    ? 'Enter new client secret (leave empty to keep current)'
                    : 'Enter your Google Client Secret'
                }
                value={clientSecretDisplayValue}
                onChange={(e) => {
                  setClientSecret(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, clientSecret: undefined }));
                  setActionResult(null);
                }}
                onFocus={handleClientSecretFocus}
                onBlur={handleClientSecretBlur}
                className="pr-10"
                aria-invalid={fieldErrors.clientSecret ? true : undefined}
                aria-describedby={fieldErrors.clientSecret ? 'clientSecret-error' : undefined}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowClientSecret(!showClientSecret)}
                tabIndex={-1}
              >
                {showClientSecret ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="sr-only">
                  {showClientSecret ? 'Hide password' : 'Show password'}
                </span>
              </Button>
            </div>
            {fieldErrors.clientSecret && (
              <p id="clientSecret-error" role="alert" className="text-xs text-destructive">
                {fieldErrors.clientSecret}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {configData?.hasClientSecret
                ? 'A client secret is already configured. Click to enter a new secret, or leave empty to keep the current one.'
                : 'Copy this from your Google Cloud Console OAuth 2.0 Client IDs'}
            </p>
          </div>

          <Separator />

          {/* Authorised JavaScript Origins */}
          <div className="space-y-4">
            <div>
              <Label>Authorised JavaScript origins</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Copy this value and add it to your Google Cloud Console OAuth configuration
              </p>
            </div>

            <div className="space-y-2">
              {javascriptOrigins.map((origin) => (
                <CopyValueRow
                  key={origin}
                  value={origin}
                  isCopied={copiedKey === origin}
                  isFailed={failedKey === origin}
                  onCopy={handleCopy}
                />
              ))}
            </div>

            {javascriptOrigins.length === 0 && (
              <p className="text-sm text-muted-foreground">
                JavaScript origins will be generated automatically based on your current domain.
              </p>
            )}
          </div>

          <Separator />

          {/* Redirect URIs */}
          <div className="space-y-4">
            <div>
              <Label>Authorized Redirect URIs</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Copy these URIs and add them to your Google Cloud Console OAuth configuration
              </p>
            </div>

            <div className="space-y-2">
              {redirectUris.map((uri) => (
                <CopyValueRow
                  key={uri}
                  value={uri}
                  isCopied={copiedKey === uri}
                  isFailed={failedKey === uri}
                  onCopy={handleCopy}
                />
              ))}
            </div>

            {fieldErrors.redirectUris && (
              <p role="alert" className="text-xs text-destructive">
                {fieldErrors.redirectUris}
              </p>
            )}

            {redirectUris.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Redirect URIs will be generated automatically based on your current domain.
              </p>
            )}
          </div>

          <Separator />

          {actionResult && (
            <Alert variant={actionResult.variant}>
              {actionResult.variant === 'destructive' ? <AlertCircle /> : <CheckCircle />}
              <AlertDescription>{actionResult.message}</AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleSave} disabled={isFormLoading}>
              {isFormLoading ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Configuration
            </Button>

            {(clientId.trim() || clientSecret.trim()) && (
              <Button variant="outline" onClick={handleTest} disabled={isTesting}>
                {isTesting ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="mr-2 h-4 w-4" />
                )}
                Test Configuration
              </Button>
            )}

            {configData && (
              <Button variant="destructive" onClick={handleReset}>
                Reset Configuration
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Setup Guide</CardTitle>
          <CardDescription>Configure Google OAuth for your application</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">1. Create Google Cloud Project</h4>
              <p className="text-muted-foreground">
                Create or select a project in Google Cloud Console. Add the Project ID above for
                easier navigation.
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-2">2. Configure OAuth Consent Screen</h4>
              <p className="text-muted-foreground mb-2">
                Set up your app information including name, support email, and authorized domains.
              </p>
              <Link
                href={googleCloudLinks.authPlatform}
                target="_blank"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
              >
                OAuth Consent Screen
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            <div>
              <h4 className="font-medium mb-2">3. Create OAuth Credentials</h4>
              <p className="text-muted-foreground mb-2">
                Create a new OAuth 2.0 Client ID with these settings:
              </p>
              <div className="ml-4 space-y-1 text-muted-foreground">
                <p>
                  • <strong>Application Type:</strong> Web Application
                </p>
                <p>
                  • <strong>Authorized JavaScript origins:</strong> Your domain(s)
                </p>
                <p>
                  • <strong>Authorized redirect URIs:</strong> Copy from the redirect URIs section
                  above
                </p>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">4. Configure Application</h4>
              <p className="text-muted-foreground">
                Copy the Client ID and Secret from your OAuth credentials and enter them in the
                configuration form above.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface CopyValueRowProps {
  value: string;
  isCopied: boolean;
  isFailed: boolean;
  onCopy: (value: string) => void;
}

/**
 * Read-only value with a Copy control. Success swaps to Check + "Copied" (the hook resets it after 2 s).
 * A failed copy shows an inline message under this row until the next copy.
 */
function CopyValueRow({ value, isCopied, isFailed, onCopy }: CopyValueRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input value={value} readOnly className="font-mono text-sm" />
        <Button variant="outline" size="sm" onClick={() => onCopy(value)}>
          {isCopied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
          {isCopied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {isFailed && (
        <p role="alert" className="text-xs text-destructive">
          Failed to copy to clipboard
        </p>
      )}
    </div>
  );
}

/**
 * Validates Google Client ID format.
 */
function _validateClientIdFormat(clientId: string): { isValid: boolean; message?: string } {
  if (!clientId.trim()) {
    return { isValid: true }; // Empty is valid (not required for validation)
  }

  const pattern = /^\d+-[a-zA-Z0-9]+\.apps\.googleusercontent\.com$/;
  if (!pattern.test(clientId.trim())) {
    return {
      isValid: false,
      message: 'Expected format: 123456789012-abcdefg.apps.googleusercontent.com',
    };
  }

  return { isValid: true };
}

/**
 * Gets CSS class for Client ID input based on validation state.
 */
function _getClientIdValidationClass(clientId: string): string {
  if (!clientId.trim()) {
    return '';
  }
  const validation = _validateClientIdFormat(clientId);
  return validation.isValid
    ? 'border-green-500 dark:border-green-400'
    : 'border-amber-500 dark:border-amber-400';
}

/**
 * Renders the Client ID field message (required / cleared), format hint, and help text.
 */
function _renderClientIdValidation(clientId: string, fieldError: string | undefined) {
  const validation = _validateClientIdFormat(clientId);
  return (
    <div className="space-y-1">
      {fieldError && (
        <p
          id="clientId-error"
          role="alert"
          className="flex items-center gap-1 text-xs text-destructive"
        >
          <AlertCircle className="h-3 w-3" />
          {fieldError}
        </p>
      )}
      {!validation.isValid && validation.message && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {validation.message}
        </p>
      )}
      {validation.isValid && clientId.trim() && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle className="h-3 w-3" />
          Client ID format looks correct
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Copy this from your Google Cloud Console OAuth 2.0 Client IDs
      </p>
    </div>
  );
}

/**
 * Generates Google Cloud Console convenience links based on project ID.
 */
function _getGoogleCloudLinks(projectId: string) {
  const hasProjectId = projectId.trim().length > 0;
  const baseUrl = 'https://console.cloud.google.com';

  return {
    hasProjectId,
    console: hasProjectId ? `${baseUrl}?project=${encodeURIComponent(projectId.trim())}` : baseUrl,
    authPlatform: hasProjectId
      ? `${baseUrl}/auth/overview?inv=1&invt=Ab1dxg&project=${encodeURIComponent(projectId.trim())}`
      : `${baseUrl}/auth/overview?inv=1&invt=Ab1dxg`,
    credentials: hasProjectId
      ? `${baseUrl}/apis/credentials?project=${encodeURIComponent(projectId.trim())}`
      : `${baseUrl}/apis/credentials`,
    apisLibrary: hasProjectId
      ? `${baseUrl}/apis/library?project=${encodeURIComponent(projectId.trim())}`
      : `${baseUrl}/apis/library`,
    oauth: hasProjectId
      ? `${baseUrl}/apis/credentials/oauthconsent?project=${encodeURIComponent(projectId.trim())}`
      : `${baseUrl}/apis/credentials/oauthconsent`,
  };
}

/**
 * Computes display value for client secret field showing masked value or user input.
 */
function _getClientSecretDisplayValue(
  configData: { hasClientSecret?: boolean } | undefined,
  clientSecretFocused: boolean,
  clientSecret: string
): string {
  const hasExistingSecret = configData?.hasClientSecret;
  const hasUserInput = clientSecret.length > 0;

  // If there's an existing secret, field is not focused, and user hasn't entered anything
  if (hasExistingSecret && !clientSecretFocused && !hasUserInput) {
    return '••••••••••••••••••••••••••••••••';
  }

  // Otherwise show the actual input value
  return clientSecret;
}

/**
 * Handles client secret field focus by setting focused state.
 */
function _handleClientSecretFocus(setClientSecretFocused: (focused: boolean) => void): void {
  setClientSecretFocused(true);
}

/**
 * Handles client secret field blur by clearing focused state.
 */
function _handleClientSecretBlur(setClientSecretFocused: (focused: boolean) => void): void {
  setClientSecretFocused(false);
}

/**
 * Handles enable/disable toggle for Google Authentication.
 */
async function _handleToggleEnabled(
  newEnabled: boolean,
  toggleEnabled: (params: { enabled: boolean }) => Promise<{ success: boolean; message: string }>,
  setEnabled: (enabled: boolean) => void,
  setToggleError: (message: string | null) => void
): Promise<void> {
  setToggleError(null);
  try {
    await toggleEnabled({ enabled: newEnabled });
    setEnabled(newEnabled);
  } catch (error: unknown) {
    console.error('Failed to toggle Google Auth:', error);
    setToggleError('Failed to toggle Google Auth. Please try again.');
  }
}

interface _SaveConfigParams {
  isFormLoading: boolean;
  setIsFormLoading: (loading: boolean) => void;
  redirectUris: string[];
  projectId: string;
  clientId: string;
  clientSecret: string;
  configData: { hasClientSecret?: boolean } | undefined;
  enabled: boolean;
  updateConfig: (params: {
    enabled: boolean;
    projectId?: string;
    clientId: string;
    clientSecret: string;
    redirectUris: string[];
  }) => Promise<{ success: boolean; message: string }>;
  setIsConfigured: (configured: boolean) => void;
  setFieldErrors: (errors: FieldErrors) => void;
  setActionResult: (result: ActionResult | null) => void;
}

/**
 * Collects every missing required field at once, so the user sees all of them in one pass.
 */
function _validateSaveInput(input: {
  redirectUris: string[];
  clientId: string;
  clientSecret: string;
  hasExistingSecret: boolean | undefined;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (input.redirectUris.length === 0) {
    errors.redirectUris = 'No redirect URIs available. Please refresh the page.';
  }
  if (!input.clientId.trim()) {
    errors.clientId = 'Client ID is required';
  }
  // A secret is required for a new configuration; an existing stored secret is kept if this is empty
  if (!input.hasExistingSecret && !input.clientSecret.trim()) {
    errors.clientSecret = 'Client Secret is required for new configuration';
  }
  return errors;
}

/**
 * Handles form submission to save Google OAuth configuration.
 */
async function _handleSave(params: _SaveConfigParams): Promise<void> {
  const {
    isFormLoading,
    setIsFormLoading,
    redirectUris,
    projectId,
    clientId,
    clientSecret,
    configData,
    enabled,
    updateConfig,
    setIsConfigured,
    setFieldErrors,
    setActionResult,
  } = params;

  if (isFormLoading) return;

  setActionResult(null);
  const errors = _validateSaveInput({
    redirectUris,
    clientId,
    clientSecret,
    hasExistingSecret: configData?.hasClientSecret,
  });
  setFieldErrors(errors);
  if (Object.keys(errors).length > 0) return;

  setIsFormLoading(true);
  try {
    await updateConfig({
      enabled, // Keep current enabled state
      projectId: projectId.trim() || undefined,
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(), // Backend will preserve existing if empty and one exists
      redirectUris: redirectUris,
    });

    setActionResult({
      variant: 'default',
      message: 'Google Auth configuration saved successfully',
    });
    setIsConfigured(true);
  } catch (error: unknown) {
    console.error('Failed to save Google Auth configuration:', error);
    setActionResult({
      variant: 'destructive',
      message: 'Failed to save configuration. Please try again.',
    });
  } finally {
    setIsFormLoading(false);
  }
}

interface _TestConfigParams {
  clientId: string;
  clientSecret: string;
  testConfig: (params: { clientId: string; clientSecret?: string }) => Promise<{
    success: boolean;
    message: string;
    details?: { issues?: string[] };
  }>;
  setFieldErrors: (errors: FieldErrors) => void;
  setActionResult: (result: ActionResult | null) => void;
  setIsTesting: (testing: boolean) => void;
}

/**
 * Tests the provided clientId and optional clientSecret. A missing Client ID is a field message;
 * the result of the call is one actionResult Alert. If no clientSecret is provided, the backend uses the saved one.
 */
async function _handleTest(args: _TestConfigParams): Promise<void> {
  const { clientId, clientSecret, testConfig, setFieldErrors, setActionResult, setIsTesting } =
    args;

  setActionResult(null);
  if (!clientId.trim()) {
    setFieldErrors({ clientId: 'Please enter a Client ID to test the configuration' });
    return;
  }
  setFieldErrors({});

  setIsTesting(true);
  try {
    const params: { clientId: string; clientSecret?: string } = {
      clientId: clientId.trim(),
    };

    // Only include clientSecret if provided
    if (clientSecret.trim()) {
      params.clientSecret = clientSecret.trim();
    }

    const result = await testConfig(params);

    setActionResult(
      result.success
        ? { variant: 'default', message: `Configuration is valid: ${result.message}` }
        : { variant: 'destructive', message: `Configuration failed: ${result.message}` }
    );
  } catch (error: unknown) {
    console.error('Failed to test Google Auth configuration:', error);
    setActionResult({
      variant: 'destructive',
      message: 'Failed to test configuration. Please try again.',
    });
  } finally {
    setIsTesting(false);
  }
}

interface _ResetConfigParams {
  resetConfig: (params: Record<string, never>) => Promise<{ success: boolean; message: string }>;
  setProjectId: (id: string) => void;
  setClientId: (id: string) => void;
  setClientSecret: (secret: string) => void;
  setIsConfigured: (configured: boolean) => void;
  setFieldErrors: (errors: FieldErrors) => void;
  setActionResult: (result: ActionResult | null) => void;
}

/**
 * Handles configuration reset with confirmation dialog. Success is silent: the cleared fields and
 * the flipped status show it. Failure is one destructive Alert.
 */
async function _handleReset(args: _ResetConfigParams): Promise<void> {
  const {
    resetConfig,
    setProjectId,
    setClientId,
    setClientSecret,
    setIsConfigured,
    setFieldErrors,
    setActionResult,
  } = args;

  if (
    !confirm(
      'Are you sure you want to reset the Google Auth configuration? This action cannot be undone.'
    )
  ) {
    return;
  }

  // Clear previous feedback only once the reset is actually attempted
  setActionResult(null);
  setFieldErrors({});

  try {
    await resetConfig({});
    // Note: enabled state is preserved and handled separately
    setProjectId('');
    setClientId('');
    setClientSecret('');
    setIsConfigured(false);
  } catch (error: unknown) {
    console.error('Failed to reset Google Auth configuration:', error);
    setActionResult({
      variant: 'destructive',
      message: 'Failed to reset configuration. Please try again.',
    });
  }
}
