/**
 * SelectorContext adapters for base role guidance functions.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { composeEnhancerSystemPrompt } from '../../enhancer/system-prompt';
import { getSoloGuidanceFromContext } from '../../teams/solo/prompts/fromContext';
import type { BuilderGuidanceParams, PlannerGuidanceParams } from '../../types/cli';
import type { SelectorContext } from '../../types/sections';
import { getCliEnvPrefix } from '../../utils/index';

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
 * The enhancer is memoryless and single-turn: its operating model IS the
 * role identity prompt, so the role-guidance surface returns the same
 * shared composition the init/spawn channels use.
 */
function getEnhancerGuidanceFromContext(ctx: SelectorContext): string {
  return composeEnhancerSystemPrompt({
    chatroomId: ctx.chatroomId ?? '',
    cliEnvPrefix: getCliEnvPrefix(ctx.convexUrl),
    convexUrl: ctx.convexUrl,
    entryPointRole: ctx.teamConfig?.entryPoint,
  });
}

/**
 * Base role guidance dispatch, keyed by lowercase role. Roles without base
 * guidance (or handled by team-specific dispatchers) resolve to undefined.
 */
const BASE_ROLE_GUIDANCE_BY_ROLE: Record<string, ((ctx: SelectorContext) => string) | undefined> = {
  planner: getBasePlannerGuidanceFromContext,
  builder: getBaseBuilderGuidanceFromContext,
  solo: getSoloGuidanceFromContext,
  enhancer: getEnhancerGuidanceFromContext,
};

export function getBaseRoleGuidanceFromContext(ctx: SelectorContext): string {
  return BASE_ROLE_GUIDANCE_BY_ROLE[ctx.role.toLowerCase()]?.(ctx) ?? '';
}
