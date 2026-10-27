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
import type * as documentPreviews from "../documentPreviews.js";
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
import type * as lib_documentPreview from "../lib/documentPreview.js";
import type * as lib_invitations from "../lib/invitations.js";
import type * as lib_invoices from "../lib/invoices.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_portfolio from "../lib/portfolio.js";
import type * as lib_processingStages from "../lib/processingStages.js";
import type * as lib_provisioning from "../lib/provisioning.js";
import type * as lib_signerPortal from "../lib/signerPortal.js";
import type * as lib_signing from "../lib/signing.js";
import type * as lib_signingAccessCrypto from "../lib/signingAccessCrypto.js";
import type * as lib_signingAlerts from "../lib/signingAlerts.js";
import type * as lib_signingAudit from "../lib/signingAudit.js";
import type * as lib_signingFields from "../lib/signingFields.js";
import type * as lib_signingFileAccess from "../lib/signingFileAccess.js";
import type * as lib_signingFinalisation from "../lib/signingFinalisation.js";
import type * as lib_signingInvitations from "../lib/signingInvitations.js";
import type * as lib_signingMfaCrypto from "../lib/signingMfaCrypto.js";
import type * as lib_signingPortfolio from "../lib/signingPortfolio.js";
import type * as lib_signingPreparation from "../lib/signingPreparation.js";
import type * as lib_signingRelease from "../lib/signingRelease.js";
import type * as lib_signingSecurity from "../lib/signingSecurity.js";
import type * as lib_signingTemplateStarters from "../lib/signingTemplateStarters.js";
import type * as lib_signingTemplates from "../lib/signingTemplates.js";
import type * as lib_signingWorker from "../lib/signingWorker.js";
import type * as lib_sourcing from "../lib/sourcing.js";
import type * as notifications from "../notifications.js";
import type * as portal from "../portal.js";
import type * as processing from "../processing.js";
import type * as properties from "../properties.js";
import type * as reports from "../reports.js";
import type * as review from "../review.js";
import type * as search from "../search.js";
import type * as signerMarks from "../signerMarks.js";
import type * as signerPortal from "../signerPortal.js";
import type * as signing from "../signing.js";
import type * as signingAccess from "../signingAccess.js";
import type * as signingAccessState from "../signingAccessState.js";
import type * as signingAttachments from "../signingAttachments.js";
import type * as signingCheckpoints from "../signingCheckpoints.js";
import type * as signingDeliveries from "../signingDeliveries.js";
import type * as signingDeliveryEvents from "../signingDeliveryEvents.js";
import type * as signingEmailPayloads from "../signingEmailPayloads.js";
import type * as signingExceptions from "../signingExceptions.js";
import type * as signingExports from "../signingExports.js";
import type * as signingFields from "../signingFields.js";
import type * as signingFiles from "../signingFiles.js";
import type * as signingFinalisation from "../signingFinalisation.js";
import type * as signingInPerson from "../signingInPerson.js";
import type * as signingInvitations from "../signingInvitations.js";
import type * as signingMfa from "../signingMfa.js";
import type * as signingMfaState from "../signingMfaState.js";
import type * as signingOperations from "../signingOperations.js";
import type * as signingPortfolio from "../signingPortfolio.js";
import type * as signingPreparations from "../signingPreparations.js";
import type * as signingRelease from "../signingRelease.js";
import type * as signingReports from "../signingReports.js";
import type * as signingTemplates from "../signingTemplates.js";
import type * as signingWebhooks from "../signingWebhooks.js";
import type * as signingWebhooksHttp from "../signingWebhooksHttp.js";
import type * as sourcing from "../sourcing.js";
import type * as tenancy from "../tenancy.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as voice from "../voice.js";

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
  documentPreviews: typeof documentPreviews;
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
  "lib/documentPreview": typeof lib_documentPreview;
  "lib/invitations": typeof lib_invitations;
  "lib/invoices": typeof lib_invoices;
  "lib/notifications": typeof lib_notifications;
  "lib/portfolio": typeof lib_portfolio;
  "lib/processingStages": typeof lib_processingStages;
  "lib/provisioning": typeof lib_provisioning;
  "lib/signerPortal": typeof lib_signerPortal;
  "lib/signing": typeof lib_signing;
  "lib/signingAccessCrypto": typeof lib_signingAccessCrypto;
  "lib/signingAlerts": typeof lib_signingAlerts;
  "lib/signingAudit": typeof lib_signingAudit;
  "lib/signingFields": typeof lib_signingFields;
  "lib/signingFileAccess": typeof lib_signingFileAccess;
  "lib/signingFinalisation": typeof lib_signingFinalisation;
  "lib/signingInvitations": typeof lib_signingInvitations;
  "lib/signingMfaCrypto": typeof lib_signingMfaCrypto;
  "lib/signingPortfolio": typeof lib_signingPortfolio;
  "lib/signingPreparation": typeof lib_signingPreparation;
  "lib/signingRelease": typeof lib_signingRelease;
  "lib/signingSecurity": typeof lib_signingSecurity;
  "lib/signingTemplateStarters": typeof lib_signingTemplateStarters;
  "lib/signingTemplates": typeof lib_signingTemplates;
  "lib/signingWorker": typeof lib_signingWorker;
  "lib/sourcing": typeof lib_sourcing;
  notifications: typeof notifications;
  portal: typeof portal;
  processing: typeof processing;
  properties: typeof properties;
  reports: typeof reports;
  review: typeof review;
  search: typeof search;
  signerMarks: typeof signerMarks;
  signerPortal: typeof signerPortal;
  signing: typeof signing;
  signingAccess: typeof signingAccess;
  signingAccessState: typeof signingAccessState;
  signingAttachments: typeof signingAttachments;
  signingCheckpoints: typeof signingCheckpoints;
  signingDeliveries: typeof signingDeliveries;
  signingDeliveryEvents: typeof signingDeliveryEvents;
  signingEmailPayloads: typeof signingEmailPayloads;
  signingExceptions: typeof signingExceptions;
  signingExports: typeof signingExports;
  signingFields: typeof signingFields;
  signingFiles: typeof signingFiles;
  signingFinalisation: typeof signingFinalisation;
  signingInPerson: typeof signingInPerson;
  signingInvitations: typeof signingInvitations;
  signingMfa: typeof signingMfa;
  signingMfaState: typeof signingMfaState;
  signingOperations: typeof signingOperations;
  signingPortfolio: typeof signingPortfolio;
  signingPreparations: typeof signingPreparations;
  signingRelease: typeof signingRelease;
  signingReports: typeof signingReports;
  signingTemplates: typeof signingTemplates;
  signingWebhooks: typeof signingWebhooks;
  signingWebhooksHttp: typeof signingWebhooksHttp;
  sourcing: typeof sourcing;
  tenancy: typeof tenancy;
  users: typeof users;
  validators: typeof validators;
  voice: typeof voice;
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
