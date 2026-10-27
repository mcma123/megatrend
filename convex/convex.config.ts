import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    // Comma-separated emails allowed to self-register and administer the platform.
    PLATFORM_ADMIN_EMAILS: v.optional(v.string()),
    // Document processing: Windmill base URL, workspace, and a token scoped to
    // run f/docling/process_document_for_app and read its jobs.
    WINDMILL_BASE_URL: v.optional(v.string()),
    WINDMILL_WORKSPACE: v.optional(v.string()),
    WINDMILL_PROCESSING_TOKEN: v.optional(v.string()),
    // Separate token: run f/docling/render_document_preview + jobs:read.
    WINDMILL_PREVIEW_TOKEN: v.optional(v.string()),
    SIGNING_MFA_KEYS_JSON: v.optional(v.string()),
    SIGNING_MFA_ACTIVE_KEY_ID: v.optional(v.string()),
    WINDMILL_SIGNING_TOKEN: v.optional(v.string()),
    WINDMILL_SIGNING_DOCUMENTS_TOKEN: v.optional(v.string()),
    // Separate token: run f/signing/finalise_agreement + jobs:read.
    WINDMILL_SIGNING_FINALISE_TOKEN: v.optional(v.string()),
    WINDMILL_SIGNING_EXPORT_TOKEN: v.optional(v.string()),
    // Deployment release key: "off" (default), "pilot" or "live". Never sufficient alone;
    // a per-company release record and all readiness checks are also required.
    SIGNING_RELEASE_MODE: v.optional(v.string()),
    SIGNING_WINDMILL_BASE_URL: v.optional(v.string()),
    SIGNING_ACCESS_KEYS_JSON: v.optional(v.string()),
    SIGNING_ACCESS_ACTIVE_KEY_ID: v.optional(v.string()),
    SIGNING_PORTAL_SERVICE_TOKEN: v.optional(v.string()),
    SIGNING_PORTAL_ORIGIN: v.optional(v.string()),
    SIGNING_SENDER_ADDRESS: v.optional(v.string()),
    WINDMILL_SIGNING_EMAIL_TOKEN: v.optional(v.string()),
    RESEND_SIGNING_WEBHOOK_SECRET: v.optional(v.string()),
    // Voice dictation/assistant limits per user (defaults 10 per minute, 200 per day).
    VOICE_RATE_LIMIT_PER_MINUTE: v.optional(v.string()),
    VOICE_DAILY_CAP: v.optional(v.string()),
  },
});
