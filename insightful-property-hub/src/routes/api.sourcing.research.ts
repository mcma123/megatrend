import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

// Convex calls this server-to-server bridge; the browser never receives its token.
export const Route = createFileRoute("/api/sourcing/research")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.MASTRA_SOURCING_SERVICE_TOKEN;
        if (!secret) {
          return Response.json(
            { error: "Property research service is not configured." },
            { status: 503 },
          );
        }
        const provided = Buffer.from(request.headers.get("authorization") ?? "");
        const expected = Buffer.from(`Bearer ${secret}`);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = await request.text();
        if (body.length > 32_000) {
          return Response.json({ error: "Property brief is too large." }, { status: 413 });
        }
        const base =
          process.env.MASTRA_API_URL ||
          process.env.MASTRA_CHAT_URL?.replace(/\/chat\/?$/, "") ||
          "http://127.0.0.1:4111";
        try {
          const response = await fetch(`${base.replace(/\/$/, "")}/sourcing/research`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
            body,
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(260_000)]),
          });
          if (!response.ok) {
            const status = [400, 401, 503].includes(response.status) ? response.status : 502;
            return Response.json(
              { error: "Property research could not complete the request." },
              { status },
            );
          }
          return Response.json(await response.json());
        } catch {
          return Response.json(
            { error: "Property research was unavailable or timed out." },
            { status: 502 },
          );
        }
      },
    },
  },
});
