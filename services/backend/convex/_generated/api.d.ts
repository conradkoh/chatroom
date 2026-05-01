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
import type * as capabilitiesRefreshCron from "../capabilitiesRefreshCron.js";
import type * as chatroom_workers_helpers from "../chatroom/workers/helpers.js";
import type * as chatroom_workers_index from "../chatroom/workers/index.js";
import type * as chatroom_workers_mutations from "../chatroom/workers/mutations.js";
import type * as chatroom_workers_queries from "../chatroom/workers/queries.js";
import type * as chatroomCleanup from "../chatroomCleanup.js";
import type * as chatroomSkillCustomizations from "../chatroomSkillCustomizations.js";
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
import type * as machineStatusCron from "../machineStatusCron.js";
import type * as machines from "../machines.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as participants from "../participants.js";
import type * as presentations from "../presentations.js";
import type * as prompts_webapp from "../prompts/webapp.js";
import type * as savedCommands from "../savedCommands.js";
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
  capabilitiesRefreshCron: typeof capabilitiesRefreshCron;
  "chatroom/workers/helpers": typeof chatroom_workers_helpers;
  "chatroom/workers/index": typeof chatroom_workers_index;
  "chatroom/workers/mutations": typeof chatroom_workers_mutations;
  "chatroom/workers/queries": typeof chatroom_workers_queries;
  chatroomCleanup: typeof chatroomCleanup;
  chatroomSkillCustomizations: typeof chatroomSkillCustomizations;
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
  machineStatusCron: typeof machineStatusCron;
  machines: typeof machines;
  messages: typeof messages;
  migrations: typeof migrations;
  participants: typeof participants;
  presentations: typeof presentations;
  "prompts/webapp": typeof prompts_webapp;
  savedCommands: typeof savedCommands;
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
  aggregate: {
    btree: {
      aggregateBetween: FunctionReference<
        "query",
        "internal",
        { k1?: any; k2?: any; namespace?: any },
        { count: number; sum: number }
      >;
      aggregateBetweenBatch: FunctionReference<
        "query",
        "internal",
        { queries: Array<{ k1?: any; k2?: any; namespace?: any }> },
        Array<{ count: number; sum: number }>
      >;
      atNegativeOffset: FunctionReference<
        "query",
        "internal",
        { k1?: any; k2?: any; namespace?: any; offset: number },
        { k: any; s: number; v: any }
      >;
      atOffset: FunctionReference<
        "query",
        "internal",
        { k1?: any; k2?: any; namespace?: any; offset: number },
        { k: any; s: number; v: any }
      >;
      atOffsetBatch: FunctionReference<
        "query",
        "internal",
        {
          queries: Array<{
            k1?: any;
            k2?: any;
            namespace?: any;
            offset: number;
          }>;
        },
        Array<{ k: any; s: number; v: any }>
      >;
      get: FunctionReference<
        "query",
        "internal",
        { key: any; namespace?: any },
        null | { k: any; s: number; v: any }
      >;
      offset: FunctionReference<
        "query",
        "internal",
        { k1?: any; key: any; namespace?: any },
        number
      >;
      offsetUntil: FunctionReference<
        "query",
        "internal",
        { k2?: any; key: any; namespace?: any },
        number
      >;
      paginate: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string;
          k1?: any;
          k2?: any;
          limit: number;
          namespace?: any;
          order: "asc" | "desc";
        },
        {
          cursor: string;
          isDone: boolean;
          page: Array<{ k: any; s: number; v: any }>;
        }
      >;
      paginateNamespaces: FunctionReference<
        "query",
        "internal",
        { cursor?: string; limit: number },
        { cursor: string; isDone: boolean; page: Array<any> }
      >;
      validate: FunctionReference<
        "query",
        "internal",
        { namespace?: any },
        any
      >;
    };
    inspect: {
      display: FunctionReference<"query", "internal", { namespace?: any }, any>;
      dump: FunctionReference<"query", "internal", { namespace?: any }, string>;
      inspectNode: FunctionReference<
        "query",
        "internal",
        { namespace?: any; node?: string },
        null
      >;
      listTreeNodes: FunctionReference<
        "query",
        "internal",
        { take?: number },
        Array<{
          _creationTime: number;
          _id: string;
          aggregate?: { count: number; sum: number };
          items: Array<{ k: any; s: number; v: any }>;
          subtrees: Array<string>;
        }>
      >;
      listTrees: FunctionReference<
        "query",
        "internal",
        { take?: number },
        Array<{
          _creationTime: number;
          _id: string;
          maxNodeSize: number;
          namespace?: any;
          root: string;
        }>
      >;
    };
    public: {
      clear: FunctionReference<
        "mutation",
        "internal",
        { maxNodeSize?: number; namespace?: any; rootLazy?: boolean },
        null
      >;
      delete_: FunctionReference<
        "mutation",
        "internal",
        { key: any; namespace?: any },
        null
      >;
      deleteIfExists: FunctionReference<
        "mutation",
        "internal",
        { key: any; namespace?: any },
        any
      >;
      init: FunctionReference<
        "mutation",
        "internal",
        { maxNodeSize?: number; namespace?: any; rootLazy?: boolean },
        null
      >;
      insert: FunctionReference<
        "mutation",
        "internal",
        { key: any; namespace?: any; summand?: number; value: any },
        null
      >;
      makeRootLazy: FunctionReference<
        "mutation",
        "internal",
        { namespace?: any },
        null
      >;
      replace: FunctionReference<
        "mutation",
        "internal",
        {
          currentKey: any;
          namespace?: any;
          newKey: any;
          newNamespace?: any;
          summand?: number;
          value: any;
        },
        null
      >;
      replaceOrInsert: FunctionReference<
        "mutation",
        "internal",
        {
          currentKey: any;
          namespace?: any;
          newKey: any;
          newNamespace?: any;
          summand?: number;
          value: any;
        },
        any
      >;
    };
  };
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
          reset?: boolean;
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
