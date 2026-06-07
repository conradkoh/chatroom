import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  AUTH_PROVIDER_MANAGE_PERMISSION,
  requireAuthenticatedPermission,
} from '../../../application/auth';
import { getAuthUser } from '../../../modules/auth/session';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { action, internalMutation, mutation, query } from '../../_generated/server';

/**
 * Google Authentication Provider Configuration Management
 *
 * All functions require the `auth:provider:manage` permission (not a role name check).
 */

/**
 * Configuration object for Google Auth settings.
 */
export interface GoogleAuthConfigData {
  type: 'google';
  enabled: boolean;
  projectId?: string;
  clientId?: string;
  clientSecret?: string;
  hasClientSecret: boolean;
  isConfigured: boolean;
  redirectUris: string[];
  configuredBy: Id<'users'>;
  configuredAt: number;
}

/**
 * Retrieves the current Google Auth configuration for system administrators.
 */
export const getConfig = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args): Promise<GoogleAuthConfigData | null> => {
    const user = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(user, AUTH_PROVIDER_MANAGE_PERMISSION, {
      unauthorizedMessage: 'Only system administrators can view Google Auth configuration',
    });

    const config = await ctx.db
      .query('auth_providerConfigs')
      .withIndex('by_type', (q) => q.eq('type', 'google'))
      .first();

    if (!config) {
      return null;
    }

    const hasClientSecret = !!config.clientSecret;
    const isConfigured = !!(config.clientId && config.clientSecret);

    return {
      type: config.type,
      enabled: config.enabled,
      projectId: config.projectId,
      clientId: config.clientId,
      clientSecret: undefined,
      hasClientSecret,
      isConfigured,
      redirectUris: config.redirectUris,
      configuredBy: config.configuredBy,
      configuredAt: config.configuredAt,
    };
  },
});

/**
 * Updates Google Auth configuration with validation and security checks.
 */
export const updateConfig = mutation({
  args: {
    enabled: v.boolean(),
    projectId: v.optional(v.string()),
    clientId: v.string(),
    clientSecret: v.string(),
    redirectUris: v.array(v.string()),
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(user, AUTH_PROVIDER_MANAGE_PERMISSION, {
      unauthorizedMessage: 'You must be logged in to configure Google Auth',
    });

    const existingConfig = await ctx.db
      .query('auth_providerConfigs')
      .withIndex('by_type', (q) => q.eq('type', 'google'))
      .first();

    if (!args.clientId.trim()) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Client ID is required',
      });
    }

    const hasExistingSecret = existingConfig && !!existingConfig.clientSecret;

    if (!hasExistingSecret && !args.clientSecret.trim()) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Client Secret is required for new configuration',
      });
    }

    for (const uri of args.redirectUris) {
      try {
        new URL(uri);
      } catch {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: `Invalid redirect URI: ${uri}`,
        });
      }
    }

    const now = Date.now();
    const clientSecretToUse = args.clientSecret.trim() || existingConfig?.clientSecret || '';

    const configData = {
      type: 'google' as const,
      enabled: args.enabled,
      projectId: args.projectId?.trim() || undefined,
      clientId: args.clientId.trim(),
      clientSecret: clientSecretToUse,
      redirectUris: args.redirectUris,
      configuredBy: user._id,
      configuredAt: now,
    };

    if (existingConfig) {
      await ctx.db.patch('auth_providerConfigs', existingConfig._id, configData);
    } else {
      await ctx.db.insert('auth_providerConfigs', configData);
    }

    return {
      success: true,
      message: 'Google Auth configuration updated successfully',
    };
  },
});

/**
 * Toggles Google Auth enabled state without changing other configuration.
 */
export const toggleEnabled = mutation({
  args: {
    enabled: v.boolean(),
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(user, AUTH_PROVIDER_MANAGE_PERMISSION, {
      unauthorizedMessage: 'You must be logged in to toggle Google Auth',
    });

    const now = Date.now();

    const existingConfig = await ctx.db
      .query('auth_providerConfigs')
      .withIndex('by_type', (q) => q.eq('type', 'google'))
      .first();

    if (existingConfig) {
      await ctx.db.patch('auth_providerConfigs', existingConfig._id, {
        enabled: args.enabled,
        configuredAt: now,
      });
    } else {
      await ctx.db.insert('auth_providerConfigs', {
        type: 'google' as const,
        enabled: args.enabled,
        clientId: '',
        clientSecret: '',
        redirectUris: [],
        configuredBy: user._id,
        configuredAt: now,
      });
    }

    return {
      success: true,
      message: `Google Auth ${args.enabled ? 'enabled' : 'disabled'} successfully`,
    };
  },
});

/**
 * Tests Google Auth configuration by validating credentials with Google's API.
 */
export const testConfig = action({
  args: {
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    ...SessionIdArg,
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    message: string;
    details?: { issues?: string[] };
  }> => {
    const authState = await ctx.runQuery(api.auth.getState, { sessionId: args.sessionId });
    if (authState.state !== 'authenticated') {
      throw new ConvexError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in to test Google Auth configuration',
      });
    }

    requireAuthenticatedPermission(authState.user, AUTH_PROVIDER_MANAGE_PERMISSION);

    let clientSecret = args.clientSecret;

    if (!clientSecret) {
      const savedSecret = await ctx.runMutation(
        internal.system.auth.google.getClientSecretForTesting,
        {
          sessionId: args.sessionId,
        }
      );

      if (!savedSecret) {
        return {
          success: false,
          message: 'No client secret provided and no saved client secret found',
          details: { issues: ['Missing Client Secret'] },
        };
      }

      clientSecret = savedSecret;
    }

    return _testNewCredentials(args.clientId, clientSecret);
  },
});

/**
 * Internal mutation to retrieve the client secret for testing purposes.
 */
export const getClientSecretForTesting = internalMutation({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args): Promise<string | null> => {
    const user = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(user, AUTH_PROVIDER_MANAGE_PERMISSION, {
      unauthorizedMessage: 'Only system administrators can access client secret for testing',
    });

    const config = await ctx.db
      .query('auth_providerConfigs')
      .withIndex('by_type', (q) => q.eq('type', 'google'))
      .first();

    return config?.clientSecret || null;
  },
});

/**
 * Tests new credentials provided by the user by making actual Google API calls.
 */
async function _testNewCredentials(
  clientId?: string,
  clientSecret?: string
): Promise<{
  success: boolean;
  message: string;
  details?: { issues?: string[] };
}> {
  const issues: string[] = [];

  if (!clientId?.trim()) {
    issues.push('Missing Client ID');
  }

  if (!clientSecret?.trim()) {
    issues.push('Missing Client Secret');
  }

  if (issues.length > 0) {
    return {
      success: false,
      message: `New credentials are incomplete: ${issues.join(', ')}`,
      details: { issues },
    };
  }

  try {
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';
    const testRedirectUri = 'http://localhost:3000/login/google/callback';

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId || '',
        client_secret: clientSecret || '',
        code: 'dummy_code_for_testing',
        grant_type: 'authorization_code',
        redirect_uri: testRedirectUri,
      }),
    });

    const result = (await response.json()) as {
      error?: string;
      error_description?: string;
    };

    if (result.error === 'invalid_grant') {
      return {
        success: true,
        message: 'Credentials are valid! Google accepted the Client ID and Secret.',
      };
    }

    if (result.error === 'invalid_client') {
      return {
        success: false,
        message: 'Invalid credentials. Please check your Client ID and Secret.',
        details: { issues: ['Invalid Client Credentials'] },
      };
    }

    if (result.error === 'redirect_uri_mismatch') {
      return {
        success: true,
        message:
          'Credentials are valid, but redirect URI configuration needs attention in Google Console.',
      };
    }

    return {
      success: false,
      message: `Unexpected response from Google: ${result.error || 'Unknown error'}`,
      details: { issues: [result.error_description || 'Unknown error'] },
    };
  } catch (_error) {
    return {
      success: false,
      message: 'Failed to test credentials due to network or server error',
      details: { issues: ['Network/Server Error'] },
    };
  }
}

/**
 * Resets Google Auth configuration by removing all stored settings.
 */
export const resetConfig = mutation({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(user, AUTH_PROVIDER_MANAGE_PERMISSION, {
      unauthorizedMessage: 'You must be logged in to reset Google Auth configuration',
    });

    const existingConfig = await ctx.db
      .query('auth_providerConfigs')
      .withIndex('by_type', (q) => q.eq('type', 'google'))
      .first();

    if (existingConfig) {
      await ctx.db.delete('auth_providerConfigs', existingConfig._id);
    }

    return {
      success: true,
      message: 'Google Auth configuration has been reset',
    };
  },
});
