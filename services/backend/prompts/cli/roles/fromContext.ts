/**
 * SelectorContext adapters for base role guidance functions.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getSoloGuidance } from '../../teams/solo/prompts/solo';
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

export function toSoloParams(ctx: SelectorContext): PlannerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    chatroomId: ctx.chatroomId,
    nativeIntegration: ctx.nativeIntegration,
  };
}

export function getSoloGuidanceFromContext(ctx: SelectorContext): string {
  return getSoloGuidance(toSoloParams(ctx));
}

export function getBasePlannerGuidanceFromContext(ctx: SelectorContext): string {
  return getPlannerGuidance(toPlannerParams(ctx));
}

export function getBaseRoleGuidanceFromContext(ctx: SelectorContext): string {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getBasePlannerGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'builder') {
    return getBaseBuilderGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'solo') {
    return getSoloGuidanceFromContext(ctx);
  }

  return '';
}
