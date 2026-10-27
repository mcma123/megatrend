import { ConvexError } from "convex/values";

export const portfolioError = (error: unknown) =>
  error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "The change could not be saved. Retry or reload the current review.";
