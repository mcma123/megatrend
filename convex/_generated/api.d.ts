/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as automations from "../automations.js";
import type * as clients from "../clients.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as invoices from "../invoices.js";
import type * as leases from "../leases.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_autoActions from "../lib/autoActions.js";
import type * as lib_automations from "../lib/automations.js";
import type * as lib_documentFields from "../lib/documentFields.js";
import type * as lib_invitations from "../lib/invitations.js";
import type * as lib_invoices from "../lib/invoices.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_portfolio from "../lib/portfolio.js";
import type * as lib_processingStages from "../lib/processingStages.js";
import type * as lib_provisioning from "../lib/provisioning.js";
import type * as lib_sourcing from "../lib/sourcing.js";
import type * as notifications from "../notifications.js";
import type * as portal from "../portal.js";
import type * as processing from "../processing.js";
import type * as properties from "../properties.js";
import type * as reports from "../reports.js";
import type * as review from "../review.js";
import type * as search from "../search.js";
import type * as sourcing from "../sourcing.js";
import type * as tenancy from "../tenancy.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  admin: typeof admin;
  auth: typeof auth;
  automations: typeof automations;
  clients: typeof clients;
  crons: typeof crons;
  dashboard: typeof dashboard;
  documents: typeof documents;
  http: typeof http;
  insights: typeof insights;
  invoices: typeof invoices;
  leases: typeof leases;
  "lib/activity": typeof lib_activity;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/autoActions": typeof lib_autoActions;
  "lib/automations": typeof lib_automations;
  "lib/documentFields": typeof lib_documentFields;
  "lib/invitations": typeof lib_invitations;
  "lib/invoices": typeof lib_invoices;
  "lib/notifications": typeof lib_notifications;
  "lib/portfolio": typeof lib_portfolio;
  "lib/processingStages": typeof lib_processingStages;
  "lib/provisioning": typeof lib_provisioning;
  "lib/sourcing": typeof lib_sourcing;
  notifications: typeof notifications;
  portal: typeof portal;
  processing: typeof processing;
  properties: typeof properties;
  reports: typeof reports;
  review: typeof review;
  search: typeof search;
  sourcing: typeof sourcing;
  tenancy: typeof tenancy;
  users: typeof users;
  validators: typeof validators;
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
