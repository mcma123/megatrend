import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    CONVEX_AUTH_ISSUER: v.optional(v.string()),
    CONVEX_AUTH_APPLICATION_ID: v.optional(v.string()),
  },
});
