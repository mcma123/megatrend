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
  },
});
