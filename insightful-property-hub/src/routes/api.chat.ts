import { createFileRoute } from "@tanstack/react-router";

const MASTRA_CHAT_URL = process.env.MASTRA_CHAT_URL ?? "http://localhost:4111/chat";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const upstream = await fetch(MASTRA_CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
          signal: request.signal,
        });

        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
            "Cache-Control": upstream.headers.get("Cache-Control") ?? "no-cache, no-transform",
            Connection: upstream.headers.get("Connection") ?? "keep-alive",
          },
        });
      },
    },
  },
});
