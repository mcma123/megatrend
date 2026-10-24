import { createFileRoute } from "@tanstack/react-router";
import { getRequestUser } from "../lib/server-auth";
import { proxyCopilotRequest } from "../lib/copilotkit-proxy.server";

export const Route = createFileRoute("/api/copilotkit")({
  server: {
    handlers: {
      POST: ({ request }) =>
        proxyCopilotRequest(request, {
          getUser: getRequestUser,
          secret: process.env.MASTRA_COPILOTKIT_SERVICE_TOKEN,
          baseUrl:
            process.env.MASTRA_API_URL ||
            process.env.MASTRA_CHAT_URL?.replace(/\/chat\/?$/, "") ||
            "http://127.0.0.1:4111",
        }),
    },
  },
});
