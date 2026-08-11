import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import type { SessionId } from 'convex-helpers/server/sessions';

import { INVITES_MANAGE_PERMISSION, requireAuthenticatedPermission } from '../../application/auth';
import { isInviteSignupAllowed } from '../../config/signupMethods';
import { generateLoginCode } from '../../modules/auth/codeUtils';
import { getAuthUser } from '../../modules/auth/session';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';

// Rate limit constants — match auth.ts verifyLoginCode
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_CODE_GENERATION_ATTEMPTS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type InviteStatus = 'active' | 'disabled' | 'expired' | 'used';

export interface InviteSummary {
  _id: Id<'invites'>;
  code: string;
  inviteeName: string;
  inviteeEmail: string;
  createdAt: number;
  expiresAt?: number;
  disabled: boolean;
  usedAt?: number;
  status: InviteStatus;
}

export type ValidateInviteResult =
  | { valid: true; inviteId: Id<'invites'>; inviteeName: string }
  | {
      valid: false;
      reason: 'invalid_code' | 'disabled' | 'expired' | 'used' | 'rate_limited';
      message: string;
      retryAfter?: number;
    };

function _normalizeCode(code: string): string {
  return code.replace(/-/g, '').toUpperCase();
}

function _getInviteStatus(invite: Doc<'invites'>, now: number): InviteStatus {
  const statusChecks: [boolean, InviteStatus][] = [
    [invite.disabled, 'disabled'],
    [Boolean(invite.usedAt), 'used'],
    [invite.expiresAt !== undefined && now > invite.expiresAt, 'expired'],
  ];

  for (const [matches, status] of statusChecks) {
    if (matches) return status;
  }

  return 'active';
}

function _isInviteActive(invite: Doc<'invites'>, now: number): boolean {
  return _getInviteStatus(invite, now) === 'active';
}

function _toInviteSummary(invite: Doc<'invites'>, now: number): InviteSummary {
  return {
    _id: invite._id,
    code: invite.code,
    inviteeName: invite.inviteeName,
    inviteeEmail: invite.inviteeEmail,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    disabled: invite.disabled,
    usedAt: invite.usedAt,
    status: _getInviteStatus(invite, now),
  };
}

function _validateInviteeInput(
  inviteeName: string,
  inviteeEmail: string
): {
  inviteeName: string;
  inviteeEmail: string;
} {
  const trimmedName = inviteeName.trim();
  const trimmedEmail = inviteeEmail.trim();

  if (!trimmedName) {
    throw new ConvexError({
      code: 'INVALID_INPUT',
      message: 'Invitee name is required',
    });
  }

  if (!trimmedEmail) {
    throw new ConvexError({
      code: 'INVALID_INPUT',
      message: 'Invitee email is required',
    });
  }

  if (!trimmedEmail.includes('@')) {
    throw new ConvexError({
      code: 'INVALID_INPUT',
      message: 'Invitee email must be a valid email address',
    });
  }

  return { inviteeName: trimmedName, inviteeEmail: trimmedEmail };
}

function _resolveExpiresAt(
  createdAt: number,
  expiry?: { type: 'days'; days: number } | { type: 'indefinite' }
): number | undefined {
  const resolvedExpiry = expiry ?? { type: 'days' as const, days: DEFAULT_EXPIRY_DAYS };

  if (resolvedExpiry.type === 'indefinite') {
    return undefined;
  }

  return createdAt + resolvedExpiry.days * MS_PER_DAY;
}

async function _setInviteDisabled(
  ctx: MutationCtx,
  inviteId: Id<'invites'>,
  disabled: boolean
): Promise<InviteSummary> {
  const invite = await ctx.db.get('invites', inviteId);
  if (!invite) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Invite not found',
    });
  }

  await ctx.db.patch('invites', inviteId, { disabled });

  const updated = await ctx.db.get('invites', inviteId);
  if (!updated) {
    throw new ConvexError({
      code: 'INTERNAL_ERROR',
      message: 'Failed to load updated invite',
    });
  }

  return _toInviteSummary(updated, Date.now());
}

async function _requireInvitesManager(
  ctx: QueryCtx | MutationCtx,
  args: { sessionId: SessionId }
): Promise<NonNullable<Awaited<ReturnType<typeof getAuthUser>>>> {
  const user = await getAuthUser(ctx, args);
  requireAuthenticatedPermission(user, INVITES_MANAGE_PERMISSION, {
    unauthorizedMessage: 'You do not have permission to manage invites',
  });
  return user;
}

async function _insertInviteWithUniqueCode(
  ctx: MutationCtx,
  input: {
    inviteeName: string;
    inviteeEmail: string;
    createdBy: Id<'users'>;
    createdAt: number;
    expiresAt?: number;
  }
): Promise<Doc<'invites'>> {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    const code = generateLoginCode();
    const existing = await ctx.db
      .query('invites')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first();

    if (!existing) {
      const inviteId = await ctx.db.insert('invites', {
        code,
        inviteeName: input.inviteeName,
        inviteeEmail: input.inviteeEmail,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        disabled: false,
      });
      const invite = await ctx.db.get('invites', inviteId);
      if (!invite) {
        throw new ConvexError({
          code: 'INTERNAL_ERROR',
          message: 'Failed to load created invite',
        });
      }
      return invite;
    }
  }

  throw new ConvexError({
    code: 'INTERNAL_ERROR',
    message: 'Failed to generate unique invite code',
  });
}

type InvalidInviteReason = Extract<ValidateInviteResult, { valid: false }>['reason'];

function _invalidInviteResult(
  reason: Exclude<InvalidInviteReason, 'rate_limited'>,
  message: string
): ValidateInviteResult {
  return { valid: false, reason, message };
}

async function _recordInviteValidationFailure(
  ctx: MutationCtx,
  sessionId: string,
  attemptRecord: Doc<'loginAttempts'> | null,
  now: number
): Promise<void> {
  if (attemptRecord) {
    const windowExpired = now - attemptRecord.lastAttemptAt > ATTEMPT_WINDOW_MS;
    const newCount = windowExpired ? 1 : attemptRecord.attemptCount + 1;
    const shouldLock = newCount >= MAX_ATTEMPTS;

    await ctx.db.patch('loginAttempts', attemptRecord._id, {
      attemptCount: newCount,
      lastAttemptAt: now,
      lockedUntil: shouldLock ? now + LOCKOUT_DURATION_MS : undefined,
    });
    return;
  }

  await ctx.db.insert('loginAttempts', {
    sessionId,
    attemptCount: 1,
    lastAttemptAt: now,
  });
}

async function _getLoginAttemptRecord(ctx: MutationCtx, sessionId: string) {
  return ctx.db
    .query('loginAttempts')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
}

function _buildRateLimitedInviteResult(lockedUntil: number, now: number): ValidateInviteResult {
  const remainingSeconds = Math.ceil((lockedUntil - now) / 1000);
  return {
    valid: false,
    reason: 'rate_limited',
    message: `Too many failed attempts. Please try again in ${remainingSeconds} seconds.`,
    retryAfter: remainingSeconds,
  };
}

async function _rejectInviteValidation(
  ctx: MutationCtx,
  sessionId: string,
  attemptRecord: Doc<'loginAttempts'> | null,
  now: number,
  reason: Exclude<InvalidInviteReason, 'rate_limited'>,
  message: string
): Promise<ValidateInviteResult> {
  await _recordInviteValidationFailure(ctx, sessionId, attemptRecord, now);
  return _invalidInviteResult(reason, message);
}

async function _validateFoundInvite(
  ctx: MutationCtx,
  sessionId: string,
  attemptRecord: Doc<'loginAttempts'> | null,
  invite: Doc<'invites'>,
  now: number
): Promise<ValidateInviteResult> {
  const status = _getInviteStatus(invite, now);
  const statusMessages: Partial<
    Record<
      InviteStatus,
      { reason: Exclude<InvalidInviteReason, 'rate_limited' | 'invalid_code'>; message: string }
    >
  > = {
    disabled: { reason: 'disabled', message: 'This invite code has been disabled' },
    expired: { reason: 'expired', message: 'This invite code has expired' },
    used: { reason: 'used', message: 'This invite code has already been used' },
  };

  const rejection = statusMessages[status];
  if (rejection) {
    return _rejectInviteValidation(
      ctx,
      sessionId,
      attemptRecord,
      now,
      rejection.reason,
      rejection.message
    );
  }

  if (!_isInviteActive(invite, now)) {
    return _rejectInviteValidation(
      ctx,
      sessionId,
      attemptRecord,
      now,
      'invalid_code',
      'Invalid invite code'
    );
  }

  if (attemptRecord) {
    await ctx.db.delete('loginAttempts', attemptRecord._id);
  }

  return {
    valid: true,
    inviteId: invite._id,
    inviteeName: invite.inviteeName,
  };
}

// fallow-ignore-next-line complexity
async function _validateInviteRecord(
  ctx: MutationCtx,
  args: { sessionId: string; code: string }
): Promise<ValidateInviteResult> {
  const now = Date.now();
  const attemptRecord = await _getLoginAttemptRecord(ctx, args.sessionId);

  if (attemptRecord?.lockedUntil && attemptRecord.lockedUntil > now) {
    return _buildRateLimitedInviteResult(attemptRecord.lockedUntil, now);
  }

  const invite = await ctx.db
    .query('invites')
    .withIndex('by_code', (q) => q.eq('code', _normalizeCode(args.code)))
    .first();

  if (!invite) {
    return _rejectInviteValidation(
      ctx,
      args.sessionId,
      attemptRecord,
      now,
      'invalid_code',
      'Invalid invite code'
    );
  }

  return _validateFoundInvite(ctx, args.sessionId, attemptRecord, invite, now);
}

/**
 * Redeems a pending invite after Google signup. Exported for auth/google.ts only — not a public Convex API.
 */
// fallow-ignore-next-line complexity
export async function redeemPendingInvite(
  ctx: MutationCtx,
  sessionId: SessionId,
  userId: Id<'users'>,
  userEmail: string
): Promise<void> {
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();

  if (!session?.pendingInviteId) {
    throw new ConvexError({
      code: 'SIGNUP_DISABLED',
      message: 'Sign-up requires an invite code',
    });
  }

  const now = Date.now();
  const invite = await ctx.db.get('invites', session.pendingInviteId);
  if (!invite || !_isInviteActive(invite, now) || invite.usedAt) {
    await ctx.db.patch('sessions', session._id, { pendingInviteId: undefined });
    throw new ConvexError({
      code: 'INVITE_INVALID',
      message: 'Invite code is no longer valid',
    });
  }

  if (userEmail.toLowerCase() !== invite.inviteeEmail.toLowerCase()) {
    throw new ConvexError({
      code: 'INVITE_EMAIL_MISMATCH',
      message: 'Google account email does not match the invited email address',
    });
  }

  await ctx.db.patch('invites', invite._id, { usedAt: now, usedByUserId: userId });
  await ctx.db.patch('users', userId, { invitedByInviteId: invite._id });
  await ctx.db.patch('sessions', session._id, { pendingInviteId: undefined });
}

export const listInvites = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args): Promise<InviteSummary[]> => {
    await _requireInvitesManager(ctx, args);

    const now = Date.now();
    const invites = await ctx.db.query('invites').collect();

    return invites
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((invite) => _toInviteSummary(invite, now));
  },
});

export const createInvite = mutation({
  args: {
    ...SessionIdArg,
    inviteeName: v.string(),
    inviteeEmail: v.string(),
    expiry: v.optional(
      v.union(
        v.object({ type: v.literal('days'), days: v.number() }),
        v.object({ type: v.literal('indefinite') })
      )
    ),
  },
  handler: async (ctx, args): Promise<InviteSummary> => {
    const user = await _requireInvitesManager(ctx, args);
    const { inviteeName, inviteeEmail } = _validateInviteeInput(
      args.inviteeName,
      args.inviteeEmail
    );
    const createdAt = Date.now();
    const invite = await _insertInviteWithUniqueCode(ctx, {
      inviteeName,
      inviteeEmail,
      createdBy: user._id,
      createdAt,
      expiresAt: _resolveExpiresAt(createdAt, args.expiry),
    });

    return _toInviteSummary(invite, createdAt);
  },
});

export const disableInvite = mutation({
  args: {
    ...SessionIdArg,
    inviteId: v.id('invites'),
  },
  handler: async (ctx, args) => {
    await _requireInvitesManager(ctx, args);
    return _setInviteDisabled(ctx, args.inviteId, true);
  },
});

// Intentional admin pair to disableInvite — allows re-enabling without recreating the invite.
export const enableInvite = mutation({
  args: {
    ...SessionIdArg,
    inviteId: v.id('invites'),
  },
  handler: async (ctx, args) => {
    await _requireInvitesManager(ctx, args);
    return _setInviteDisabled(ctx, args.inviteId, false);
  },
});

export const deleteInvite = mutation({
  args: {
    ...SessionIdArg,
    inviteId: v.id('invites'),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    await _requireInvitesManager(ctx, args);

    const invite = await ctx.db.get('invites', args.inviteId);
    if (!invite) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Invite not found',
      });
    }

    await ctx.db.delete('invites', args.inviteId);

    return { success: true };
  },
});

export const validateInviteCode = mutation({
  args: {
    ...SessionIdArg,
    code: v.string(),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args): Promise<ValidateInviteResult> => {
    if (!isInviteSignupAllowed()) {
      return {
        valid: false,
        reason: 'invalid_code',
        message: 'Invalid invite code',
      };
    }

    const existingSession = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .first();

    if (existingSession?.userId) {
      return {
        valid: false,
        reason: 'invalid_code',
        message: 'Invalid invite code',
      };
    }

    const result = await _validateInviteRecord(ctx, args);
    if (!result.valid) {
      return result;
    }

    const now = Date.now();
    if (existingSession) {
      await ctx.db.patch('sessions', existingSession._id, {
        pendingInviteId: result.inviteId,
      });
    } else {
      await ctx.db.insert('sessions', {
        sessionId: args.sessionId,
        createdAt: now,
        pendingInviteId: result.inviteId,
      });
    }

    return result;
  },
});
