/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as conversations from "../conversations.js";
import type * as dictionary from "../dictionary.js";
import type * as folders from "../folders.js";
import type * as http from "../http.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_identity from "../lib/identity.js";
import type * as notes from "../notes.js";
import type * as snippets from "../snippets.js";
import type * as spaces from "../spaces.js";
import type * as transcriptions from "../transcriptions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  conversations: typeof conversations;
  dictionary: typeof dictionary;
  folders: typeof folders;
  http: typeof http;
  "lib/http": typeof lib_http;
  "lib/identity": typeof lib_identity;
  notes: typeof notes;
  snippets: typeof snippets;
  spaces: typeof spaces;
  transcriptions: typeof transcriptions;
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
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
