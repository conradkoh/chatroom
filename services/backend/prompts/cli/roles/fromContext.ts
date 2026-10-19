/**
 * SelectorContext adapters for base role guidance functions.
 */

import { getArchitectGuidance } from './architect';
import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getResearcherGuidance } from './researcher';
import { getTriageGuidance } from './triage';
import { getUiuxEngineerGuidance } from './uiux-engineer';
import { getVerifierGuidance } from './verifier';
import { getSoloGuidanceFromContext } from '../../teams/solo/prompts/fromContext';
import type { BuilderGuidanceParams, PlannerGuidanceParams } from '../../types/cli';
import type { SelectorContext } from '../../types/sections';
import { listHandoffTemplatePairs } from '../handoff-templates';

export function toBuilderParams(ctx: SelectorContext): BuilderGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    nativeIntegration: ctx.nativeIntegration,
  };
}

export function toPlannerParams(ctx: SelectorContext): PlannerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    chatroomId: ctx.chatroomId,
    nativeIntegration: ctx.nativeIntegration,
  };
}

export function getBaseBuilderGuidanceFromContext(ctx: SelectorContext): string {
  return getBuilderGuidance(toBuilderParams(ctx));
}

export function getBasePlannerGuidanceFromContext(ctx: SelectorContext): string {
  return getPlannerGuidance(toPlannerParams(ctx));
}

/**
 * Recipient a specialist guidance hands off to, taken from the team's
 * role-handoff contract.
 *
 * For a builtin team (`duo`/`solo`) the contract's `returnsTo` supplies the
 * recipient; every builtin specialist contract returns to exactly one role, so
 * the first pair is that recipient. For a custom or unknown team (or a role
 * with no builtin contract) `listHandoffTemplatePairs` yields no pairs and the
 * team's configured entry point is used; the empty string means neither exists.
 */
function resolveSpecialistRecipientRole(ctx: SelectorContext): string {
  const pairs = listHandoffTemplatePairs(ctx.team, ctx.role);
  if (pairs.length > 0) return pairs[0].toRole;
  return ctx.teamConfig?.entryPoint ?? '';
}

/**
 * Base role guidance dispatch, keyed by lowercase role. Roles without base
 * guidance (or handled by team-specific dispatchers) resolve to undefined.
 */
const BASE_ROLE_GUIDANCE_BY_ROLE: Record<string, ((ctx: SelectorContext) => string) | undefined> = {
  planner: getBasePlannerGuidanceFromContext,
  builder: getBaseBuilderGuidanceFromContext,
  solo: getSoloGuidanceFromContext,
  architect: (ctx) =>
    getArchitectGuidance({
      nativeIntegration: ctx.nativeIntegration,
      recipientRole: resolveSpecialistRecipientRole(ctx),
    }),
  researcher: (ctx) =>
    getResearcherGuidance({
      nativeIntegration: ctx.nativeIntegration,
      recipientRole: resolveSpecialistRecipientRole(ctx),
    }),
  triage: (ctx) =>
    getTriageGuidance({
      nativeIntegration: ctx.nativeIntegration,
      recipientRole: resolveSpecialistRecipientRole(ctx),
    }),
  verifier: (ctx) =>
    getVerifierGuidance({
      nativeIntegration: ctx.nativeIntegration,
      recipientRole: resolveSpecialistRecipientRole(ctx),
    }),
  'uiux-engineer': (ctx) =>
    getUiuxEngineerGuidance({
      nativeIntegration: ctx.nativeIntegration,
      recipientRole: resolveSpecialistRecipientRole(ctx),
    }),
};

export function getBaseRoleGuidanceFromContext(ctx: SelectorContext): string {
  return BASE_ROLE_GUIDANCE_BY_ROLE[ctx.role.toLowerCase()]?.(ctx) ?? '';
}
