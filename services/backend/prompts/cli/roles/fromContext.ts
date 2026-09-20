/**
 * SelectorContext adapters for base role guidance functions.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getSpecialistGuidance } from './specialists';
import { getSoloGuidanceFromContext } from '../../teams/solo/prompts/fromContext';
import type { BuilderGuidanceParams, PlannerGuidanceParams } from '../../types/cli';
import type { SelectorContext } from '../../types/sections';

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
 * Base role guidance dispatch, keyed by lowercase role. Roles without base
 * guidance (or handled by team-specific dispatchers) resolve to undefined.
 */
const BASE_ROLE_GUIDANCE_BY_ROLE: Record<string, ((ctx: SelectorContext) => string) | undefined> = {
  planner: getBasePlannerGuidanceFromContext,
  builder: getBaseBuilderGuidanceFromContext,
  solo: getSoloGuidanceFromContext,
  architect: (ctx) =>
    getSpecialistGuidance({
      role: ctx.role,
      nativeIntegration: ctx.nativeIntegration,
      entryPointRole: ctx.teamConfig?.entryPoint ?? 'planner',
    }),
  'uiux-engineer': (ctx) =>
    getSpecialistGuidance({
      role: ctx.role,
      nativeIntegration: ctx.nativeIntegration,
      entryPointRole: ctx.teamConfig?.entryPoint ?? 'planner',
    }),
};

export function getBaseRoleGuidanceFromContext(ctx: SelectorContext): string {
  return BASE_ROLE_GUIDANCE_BY_ROLE[ctx.role.toLowerCase()]?.(ctx) ?? '';
}
