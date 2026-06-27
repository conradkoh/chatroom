/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentResumeStorm from "../agentResumeStorm.js";
import type * as api_directHarnessHelpers from "../api/directHarnessHelpers.js";
import type * as appinfo from "../appinfo.js";
import type * as artifacts from "../artifacts.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as auth_chatroomAccess from "../auth/chatroomAccess.js";
import type * as auth_cli_machineAccess from "../auth/cli/machineAccess.js";
import type * as auth_cli_workspaceAccess from "../auth/cli/workspaceAccess.js";
import type * as auth_google from "../auth/google.js";
import type * as auth_session from "../auth/session.js";
import type * as auth_sessionValidation from "../auth/sessionValidation.js";
import type * as backlog from "../backlog.js";
import type * as capabilitiesRefreshCron from "../capabilitiesRefreshCron.js";
import type * as chatroomCleanup from "../chatroomCleanup.js";
import type * as chatroomSkillCustomizations from "../chatroomSkillCustomizations.js";
import type * as chatrooms from "../chatrooms.js";
import type * as checklists from "../checklists.js";
import type * as cleanupTasks from "../cleanupTasks.js";
import type * as cliAuth from "../cliAuth.js";
import type * as commands from "../commands.js";
import type * as commands_fsm from "../commands/fsm.js";
import type * as commands_mutations from "../commands/mutations.js";
import type * as commands_process_run_status from "../commands/process/run_status.js";
import type * as commands_process_state from "../commands/process/state.js";
import type * as commands_process_sync from "../commands/process/sync.js";
import type * as commands_queries from "../commands/queries.js";
import type * as commands_types from "../commands/types.js";
import type * as connectionCleanup from "../connectionCleanup.js";
import type * as connections from "../connections.js";
import type * as contexts from "../contexts.js";
import type * as crons from "../crons.js";
import type * as crypto from "../crypto.js";
import type * as daemon_commands from "../daemon/commands.js";
import type * as daemon_directHarness_capabilities from "../daemon/directHarness/capabilities.js";
import type * as daemon_directHarness_commands from "../daemon/directHarness/commands.js";
import type * as daemon_directHarness_messages from "../daemon/directHarness/messages.js";
import type * as daemon_directHarness_queue from "../daemon/directHarness/queue.js";
import type * as daemon_directHarness_sessions from "../daemon/directHarness/sessions.js";
import type * as daemon_directHarness_turns from "../daemon/directHarness/turns.js";
import type * as dev from "../dev.js";
import type * as directHarnessCleanup from "../directHarnessCleanup.js";
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
import type * as lib_chatroomUtils from "../lib/chatroomUtils.js";
import type * as lib_handoffRoles from "../lib/handoffRoles.js";
import type * as lib_hierarchy from "../lib/hierarchy.js";
import type * as lib_promoteNextTaskDeps from "../lib/promoteNextTaskDeps.js";
import type * as lib_stdinDecoder from "../lib/stdinDecoder.js";
import type * as lib_taskStateMachine from "../lib/taskStateMachine.js";
import type * as lib_taskWorkflows from "../lib/taskWorkflows.js";
import type * as machineStatusCron from "../machineStatusCron.js";
import type * as machines from "../machines.js";
import type * as messageList from "../messageList.js";
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
import type * as utils_teamRoleKey from "../utils/teamRoleKey.js";
import type * as utils_types from "../utils/types.js";
import type * as web_directHarness_capabilities from "../web/directHarness/capabilities.js";
import type * as web_directHarness_commands from "../web/directHarness/commands.js";
import type * as web_directHarness_messageQueue from "../web/directHarness/messageQueue.js";
import type * as web_directHarness_messages from "../web/directHarness/messages.js";
import type * as web_directHarness_sessions from "../web/directHarness/sessions.js";
import type * as web_directHarness_turns from "../web/directHarness/turns.js";
import type * as workspaceFiles from "../workspaceFiles.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentResumeStorm: typeof agentResumeStorm;
  "api/directHarnessHelpers": typeof api_directHarnessHelpers;
  appinfo: typeof appinfo;
  artifacts: typeof artifacts;
  attendance: typeof attendance;
  auth: typeof auth;
  "auth/chatroomAccess": typeof auth_chatroomAccess;
  "auth/cli/machineAccess": typeof auth_cli_machineAccess;
  "auth/cli/workspaceAccess": typeof auth_cli_workspaceAccess;
  "auth/google": typeof auth_google;
  "auth/session": typeof auth_session;
  "auth/sessionValidation": typeof auth_sessionValidation;
  backlog: typeof backlog;
  capabilitiesRefreshCron: typeof capabilitiesRefreshCron;
  chatroomCleanup: typeof chatroomCleanup;
  chatroomSkillCustomizations: typeof chatroomSkillCustomizations;
  chatrooms: typeof chatrooms;
  checklists: typeof checklists;
  cleanupTasks: typeof cleanupTasks;
  cliAuth: typeof cliAuth;
  commands: typeof commands;
  "commands/fsm": typeof commands_fsm;
  "commands/mutations": typeof commands_mutations;
  "commands/process/run_status": typeof commands_process_run_status;
  "commands/process/state": typeof commands_process_state;
  "commands/process/sync": typeof commands_process_sync;
  "commands/queries": typeof commands_queries;
  "commands/types": typeof commands_types;
  connectionCleanup: typeof connectionCleanup;
  connections: typeof connections;
  contexts: typeof contexts;
  crons: typeof crons;
  crypto: typeof crypto;
  "daemon/commands": typeof daemon_commands;
  "daemon/directHarness/capabilities": typeof daemon_directHarness_capabilities;
  "daemon/directHarness/commands": typeof daemon_directHarness_commands;
  "daemon/directHarness/messages": typeof daemon_directHarness_messages;
  "daemon/directHarness/queue": typeof daemon_directHarness_queue;
  "daemon/directHarness/sessions": typeof daemon_directHarness_sessions;
  "daemon/directHarness/turns": typeof daemon_directHarness_turns;
  dev: typeof dev;
  directHarnessCleanup: typeof directHarnessCleanup;
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
  "lib/chatroomUtils": typeof lib_chatroomUtils;
  "lib/handoffRoles": typeof lib_handoffRoles;
  "lib/hierarchy": typeof lib_hierarchy;
  "lib/promoteNextTaskDeps": typeof lib_promoteNextTaskDeps;
  "lib/stdinDecoder": typeof lib_stdinDecoder;
  "lib/taskStateMachine": typeof lib_taskStateMachine;
  "lib/taskWorkflows": typeof lib_taskWorkflows;
  machineStatusCron: typeof machineStatusCron;
  machines: typeof machines;
  messageList: typeof messageList;
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
  "utils/teamRoleKey": typeof utils_teamRoleKey;
  "utils/types": typeof utils_types;
  "web/directHarness/capabilities": typeof web_directHarness_capabilities;
  "web/directHarness/commands": typeof web_directHarness_commands;
  "web/directHarness/messageQueue": typeof web_directHarness_messageQueue;
  "web/directHarness/messages": typeof web_directHarness_messages;
  "web/directHarness/sessions": typeof web_directHarness_sessions;
  "web/directHarness/turns": typeof web_directHarness_turns;
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
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
