/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appinfo from '../appinfo.js';
import type * as artifacts from '../artifacts.js';
import type * as attendance from '../attendance.js';
import type * as auth from '../auth.js';
import type * as auth_google from '../auth/google.js';
import type * as chatrooms from '../chatrooms.js';
import type * as checklists from '../checklists.js';
import type * as cleanupTasks from '../cleanupTasks.js';
import type * as cliAuth from '../cliAuth.js';
import type * as crons from '../crons.js';
import type * as crypto from '../crypto.js';
import type * as discussions from '../discussions.js';
import type * as guidelines from '../guidelines.js';
import type * as lib_cliSessionAuth from '../lib/cliSessionAuth.js';
import type * as lib_hierarchy from '../lib/hierarchy.js';
import type * as lib_taskRecovery from '../lib/taskRecovery.js';
import type * as lib_taskWorkflows from '../lib/taskWorkflows.js';
import type * as messages from '../messages.js';
import type * as migration from '../migration.js';
import type * as participants from '../participants.js';
import type * as presentations from '../presentations.js';
import type * as prompts_config from '../prompts/config.js';
import type * as prompts_generator from '../prompts/generator.js';
import type * as prompts_guidelines_index from '../prompts/guidelines/index.js';
import type * as prompts_guidelines_review from '../prompts/guidelines/review.js';
import type * as prompts_index from '../prompts/index.js';
import type * as prompts_init_base from '../prompts/init/base.js';
import type * as prompts_init_index from '../prompts/init/index.js';
import type * as prompts_init_roles from '../prompts/init/roles.js';
import type * as prompts_init_taskStarted from '../prompts/init/taskStarted.js';
import type * as prompts_init_waitForTask from '../prompts/init/waitForTask.js';
import type * as prompts_policies_design from '../prompts/policies/design.js';
import type * as prompts_policies_index from '../prompts/policies/index.js';
import type * as prompts_policies_performance from '../prompts/policies/performance.js';
import type * as prompts_policies_security from '../prompts/policies/security.js';
import type * as prompts_taskDelivery_formatters from '../prompts/taskDelivery/formatters.js';
import type * as prompts_taskDelivery_index from '../prompts/taskDelivery/index.js';
import type * as prompts_taskDelivery_sections_backlogCommands from '../prompts/taskDelivery/sections/backlogCommands.js';
import type * as prompts_taskDelivery_sections_chatroomState from '../prompts/taskDelivery/sections/chatroomState.js';
import type * as prompts_taskDelivery_sections_index from '../prompts/taskDelivery/sections/index.js';
import type * as prompts_taskDelivery_sections_jsonOutput from '../prompts/taskDelivery/sections/jsonOutput.js';
import type * as prompts_taskDelivery_sections_messageReceived from '../prompts/taskDelivery/sections/messageReceived.js';
import type * as prompts_taskDelivery_sections_nextSteps from '../prompts/taskDelivery/sections/nextSteps.js';
import type * as prompts_taskDelivery_sections_roleGuidance from '../prompts/taskDelivery/sections/roleGuidance.js';
import type * as prompts_taskDelivery_types from '../prompts/taskDelivery/types.js';
import type * as prompts_templates from '../prompts/templates.js';
import type * as serviceDesk from '../serviceDesk.js';
import type * as system_auth_google from '../system/auth/google.js';
import type * as tasks from '../tasks.js';

import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

declare const fullApi: ApiFromModules<{
  appinfo: typeof appinfo;
  artifacts: typeof artifacts;
  attendance: typeof attendance;
  auth: typeof auth;
  'auth/google': typeof auth_google;
  chatrooms: typeof chatrooms;
  checklists: typeof checklists;
  cleanupTasks: typeof cleanupTasks;
  cliAuth: typeof cliAuth;
  crons: typeof crons;
  crypto: typeof crypto;
  discussions: typeof discussions;
  guidelines: typeof guidelines;
  'lib/cliSessionAuth': typeof lib_cliSessionAuth;
  'lib/hierarchy': typeof lib_hierarchy;
  'lib/taskRecovery': typeof lib_taskRecovery;
  'lib/taskWorkflows': typeof lib_taskWorkflows;
  messages: typeof messages;
  migration: typeof migration;
  participants: typeof participants;
  presentations: typeof presentations;
  'prompts/config': typeof prompts_config;
  'prompts/generator': typeof prompts_generator;
  'prompts/guidelines/index': typeof prompts_guidelines_index;
  'prompts/guidelines/review': typeof prompts_guidelines_review;
  'prompts/index': typeof prompts_index;
  'prompts/init/base': typeof prompts_init_base;
  'prompts/init/index': typeof prompts_init_index;
  'prompts/init/roles': typeof prompts_init_roles;
  'prompts/init/taskStarted': typeof prompts_init_taskStarted;
  'prompts/init/waitForTask': typeof prompts_init_waitForTask;
  'prompts/policies/design': typeof prompts_policies_design;
  'prompts/policies/index': typeof prompts_policies_index;
  'prompts/policies/performance': typeof prompts_policies_performance;
  'prompts/policies/security': typeof prompts_policies_security;
  'prompts/taskDelivery/formatters': typeof prompts_taskDelivery_formatters;
  'prompts/taskDelivery/index': typeof prompts_taskDelivery_index;
  'prompts/taskDelivery/sections/backlogCommands': typeof prompts_taskDelivery_sections_backlogCommands;
  'prompts/taskDelivery/sections/chatroomState': typeof prompts_taskDelivery_sections_chatroomState;
  'prompts/taskDelivery/sections/index': typeof prompts_taskDelivery_sections_index;
  'prompts/taskDelivery/sections/jsonOutput': typeof prompts_taskDelivery_sections_jsonOutput;
  'prompts/taskDelivery/sections/messageReceived': typeof prompts_taskDelivery_sections_messageReceived;
  'prompts/taskDelivery/sections/nextSteps': typeof prompts_taskDelivery_sections_nextSteps;
  'prompts/taskDelivery/sections/roleGuidance': typeof prompts_taskDelivery_sections_roleGuidance;
  'prompts/taskDelivery/types': typeof prompts_taskDelivery_types;
  'prompts/templates': typeof prompts_templates;
  serviceDesk: typeof serviceDesk;
  'system/auth/google': typeof system_auth_google;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;

export declare const components: {};
