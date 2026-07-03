import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_MASTRA_CHAT_URL = process.env.MASTRA_CHAT_URL ?? "http://localhost:4111/chat";
const MASTRA_CHAT_URLS: Record<string, string> = {
  "web-research-agent": DEFAULT_MASTRA_CHAT_URL,
  "okf-agent": process.env.MASTRA_OKF_CHAT_URL ?? "http://localhost:4111/chat/okf",
  "facebook-marketplace-agent":
    process.env.MASTRA_FACEBOOK_MARKETPLACE_CHAT_URL ??
    "http://localhost:4111/chat/facebook-marketplace",
};

function resolveMastraChatUrl(bodyText: string) {
  try {
    const payload = JSON.parse(bodyText) as {
      requestContext?: {
        selectedAgent?: string;
      };
    };

    const selectedAgent = payload.requestContext?.selectedAgent;
    return (selectedAgent && MASTRA_CHAT_URLS[selectedAgent]) || DEFAULT_MASTRA_CHAT_URL;
  } catch {
    return DEFAULT_MASTRA_CHAT_URL;
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const upstream = await fetch(resolveMastraChatUrl(body), {
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
