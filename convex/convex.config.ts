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
    // Voice dictation/assistant limits per user (defaults 10 per minute, 200 per day).
    VOICE_RATE_LIMIT_PER_MINUTE: v.optional(v.string()),
    VOICE_DAILY_CAP: v.optional(v.string()),
  },
});
