import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    // Comma-separated emails allowed to self-register and administer the platform.
    PLATFORM_ADMIN_EMAILS: v.optional(v.string()),
  },
});
