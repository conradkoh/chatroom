/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appinfo from "../appinfo.js";
import type * as artifacts from "../artifacts.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as auth_accessCheck from "../auth/accessCheck.js";
import type * as auth_authenticatedUser from "../auth/authenticatedUser.js";
import type * as auth_cliSessionAuth from "../auth/cliSessionAuth.js";
import type * as auth_google from "../auth/google.js";
import type * as backlog from "../backlog.js";
import type * as chatrooms from "../chatrooms.js";
import type * as checklists from "../checklists.js";
import type * as cleanupTasks from "../cleanupTasks.js";
import type * as cliAuth from "../cliAuth.js";
import type * as commands from "../commands.js";
import type * as contexts from "../contexts.js";
import type * as crons from "../crons.js";
import type * as crypto from "../crypto.js";
import type * as discussions from "../discussions.js";
import type * as eventCleanup from "../eventCleanup.js";
import type * as events from "../events.js";
import type * as guidelines from "../guidelines.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as integrations_index from "../integrations/index.js";
import type * as integrations_telegram_actions from "../integrations/telegram/actions.js";
import type * as integrations_telegram_api from "../integrations/telegram/api.js";
import type * as integrations_telegram_index from "../integrations/telegram/index.js";
import type * as integrations_telegram_internal from "../integrations/telegram/internal.js";
import type * as integrations_telegram_types from "../integrations/telegram/types.js";
import type * as integrations_types from "../integrations/types.js";
import type * as lib_backlogStateMachine from "../lib/backlogStateMachine.js";
import type * as lib_hierarchy from "../lib/hierarchy.js";
import type * as lib_promoteNextTaskDeps from "../lib/promoteNextTaskDeps.js";
import type * as lib_stdinDecoder from "../lib/stdinDecoder.js";
import type * as lib_taskStateMachine from "../lib/taskStateMachine.js";
import type * as lib_taskWorkflows from "../lib/taskWorkflows.js";
import type * as machines from "../machines.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as participants from "../participants.js";
import type * as presentations from "../presentations.js";
import type * as prompts_webapp from "../prompts/webapp.js";
import type * as serviceDesk from "../serviceDesk.js";
import type * as sessions from "../sessions.js";
import type * as skills from "../skills.js";
import type * as storageCleanup from "../storageCleanup.js";
import type * as system_auth_google from "../system/auth/google.js";
import type * as tasks from "../tasks.js";
import type * as tasks_taskDelivery from "../tasks/taskDelivery.js";
import type * as utils_teamRoleKey from "../utils/teamRoleKey.js";
import type * as utils_types from "../utils/types.js";
import type * as workflows from "../workflows.js";
import type * as workspaceFiles from "../workspaceFiles.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appinfo: typeof appinfo;
  artifacts: typeof artifacts;
  attendance: typeof attendance;
  auth: typeof auth;
  "auth/accessCheck": typeof auth_accessCheck;
  "auth/authenticatedUser": typeof auth_authenticatedUser;
  "auth/cliSessionAuth": typeof auth_cliSessionAuth;
  "auth/google": typeof auth_google;
  backlog: typeof backlog;
  chatrooms: typeof chatrooms;
  checklists: typeof checklists;
  cleanupTasks: typeof cleanupTasks;
  cliAuth: typeof cliAuth;
  commands: typeof commands;
  contexts: typeof contexts;
  crons: typeof crons;
  crypto: typeof crypto;
  discussions: typeof discussions;
  eventCleanup: typeof eventCleanup;
  events: typeof events;
  guidelines: typeof guidelines;
  http: typeof http;
  integrations: typeof integrations;
  "integrations/index": typeof integrations_index;
  "integrations/telegram/actions": typeof integrations_telegram_actions;
  "integrations/telegram/api": typeof integrations_telegram_api;
  "integrations/telegram/index": typeof integrations_telegram_index;
  "integrations/telegram/internal": typeof integrations_telegram_internal;
  "integrations/telegram/types": typeof integrations_telegram_types;
  "integrations/types": typeof integrations_types;
  "lib/backlogStateMachine": typeof lib_backlogStateMachine;
  "lib/hierarchy": typeof lib_hierarchy;
  "lib/promoteNextTaskDeps": typeof lib_promoteNextTaskDeps;
  "lib/stdinDecoder": typeof lib_stdinDecoder;
  "lib/taskStateMachine": typeof lib_taskStateMachine;
  "lib/taskWorkflows": typeof lib_taskWorkflows;
  machines: typeof machines;
  messages: typeof messages;
  migrations: typeof migrations;
  participants: typeof participants;
  presentations: typeof presentations;
  "prompts/webapp": typeof prompts_webapp;
  serviceDesk: typeof serviceDesk;
  sessions: typeof sessions;
  skills: typeof skills;
  storageCleanup: typeof storageCleanup;
  "system/auth/google": typeof system_auth_google;
  tasks: typeof tasks;
  "tasks/taskDelivery": typeof tasks_taskDelivery;
  "utils/teamRoleKey": typeof utils_teamRoleKey;
  "utils/types": typeof utils_types;
  workflows: typeof workflows;
  workspaceFiles: typeof workspaceFiles;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
          oneBatchOnly?: boolean;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
};
