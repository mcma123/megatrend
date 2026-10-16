import { timingSafeEqual } from "node:crypto";
import { registerApiRoute } from "@mastra/core/server";
import { sourcingInputSchema } from "../../../convex/lib/sourcing";
import { researchProperties } from "../application/web-research/property-sourcing-service";

export const propertySourcingRoute = registerApiRoute("/sourcing/research", {
  method: "POST",
  handler: async (context) => {
    const secret = process.env.MASTRA_SOURCING_SERVICE_TOKEN;
    if (!secret)
      return context.json(
        { error: "Property research service is not configured." },
        503,
      );
    const provided = context.req.header("Authorization") ?? "";
    const expected = `Bearer ${secret}`;
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    const input = sourcingInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json({ error: "Invalid property brief." }, 400);
    const abortSignal = AbortSignal.any([
      context.req.raw.signal,
      AbortSignal.timeout(240_000),
    ]);
    try {
      const agent = context.get("mastra").getAgent("webResearchAgent");
      const result = await researchProperties(agent, input.data, abortSignal);
      return context.json(result);
    } catch (failure) {
      // Server log only (no listing content or secrets); the response stays sanitized.
      console.error(
        "[sourcing] research failed:",
        failure instanceof Error ? failure.message.slice(0, 300) : "unknown error",
      );
      return context.json(
        { error: "Property research failed or timed out. Try again." },
        502,
      );
    }
  },
});
