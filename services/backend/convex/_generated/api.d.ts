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
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as auth_google from "../auth/google.js";
import type * as chatrooms from "../chatrooms.js";
import type * as checklists from "../checklists.js";
import type * as cleanupTasks from "../cleanupTasks.js";
import type * as cliAuth from "../cliAuth.js";
import type * as crypto from "../crypto.js";
import type * as discussions from "../discussions.js";
import type * as lib_cliSessionAuth from "../lib/cliSessionAuth.js";
import type * as lib_hierarchy from "../lib/hierarchy.js";
import type * as messages from "../messages.js";
import type * as migration from "../migration.js";
import type * as participants from "../participants.js";
import type * as presentations from "../presentations.js";
import type * as serviceDesk from "../serviceDesk.js";
import type * as system_auth_google from "../system/auth/google.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appinfo: typeof appinfo;
  attendance: typeof attendance;
  auth: typeof auth;
  "auth/google": typeof auth_google;
  chatrooms: typeof chatrooms;
  checklists: typeof checklists;
  cleanupTasks: typeof cleanupTasks;
  cliAuth: typeof cliAuth;
  crypto: typeof crypto;
  discussions: typeof discussions;
  "lib/cliSessionAuth": typeof lib_cliSessionAuth;
  "lib/hierarchy": typeof lib_hierarchy;
  messages: typeof messages;
  migration: typeof migration;
  participants: typeof participants;
  presentations: typeof presentations;
  serviceDesk: typeof serviceDesk;
  "system/auth/google": typeof system_auth_google;
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

export declare const components: {};
