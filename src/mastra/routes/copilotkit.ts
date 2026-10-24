import { timingSafeEqual } from "node:crypto";
import { MastraAgent } from "@ag-ui/mastra";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { RequestContext } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import type { Mastra } from "@mastra/core/mastra";

export const CHAT_AGENTS = [
  "web-research-agent",
  "okf-agent",
  "facebook-marketplace-agent",
] as const;
const AGENT_KEYS = [
  "webResearchAgent",
  "okfAgent",
  "facebookMarketplaceAgent",
] as const;

export function authorizeCopilotRequest(
  request: Request,
  secret: string | undefined,
) {
  if (!secret) return 503;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return 401;
  const userId = request.headers.get("x-cyphersoft-user-id");
  return userId && /^[a-zA-Z0-9_-]{1,128}$/.test(userId) ? 200 : 401;
}

/** Auth headers must never enter CopilotKit's automatic provider-header forwarding. */
export function cleanRuntimeRequest(request: Request) {
  return new Request(request, {
    headers: {
      "Content-Type": "application/json",
      Accept:
        request.headers.get("accept") ?? "application/json, text/event-stream",
    },
  });
}

export function chatRequestContext(request: Request) {
  const context = new RequestContext();
  context.set("richOutput", "true");
  const model = request.headers.get("x-cyphersoft-model");
  if (model && model.length <= 200 && /^[\w./:-]+$/.test(model))
    context.set("selectedModel", model);
  context.set(
    "includeImages",
    request.headers.get("x-cyphersoft-images") === "true" ? "true" : "false",
  );
  return context;
}

/** The OSS runner stores threads process-wide. Bind IDs to the verified actor,
 * and keep its history/list/clear endpoints outside this presentation surface. */
export function authorizeCopilotOperation(userId: string, payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const operation = payload as {
    method?: unknown;
    params?: { agentId?: unknown; threadId?: unknown };
    body?: { threadId?: unknown };
  };
  if (operation.method === "info") return true;
  if (
    ![
      "agent/run",
      "agent/connect",
      "agent/stop",
      "agent/is_running",
      "agent/isRunning",
      "agent/is-running",
    ].includes(String(operation.method))
  )
    return false;
  const agentId = operation.params?.agentId;
  const threadId =
    operation.method === "agent/run" || operation.method === "agent/connect"
      ? operation.body?.threadId
      : operation.params?.threadId;
  return (
    typeof agentId === "string" &&
    CHAT_AGENTS.some((id) => id === agentId) &&
    typeof threadId === "string" &&
    threadId.length <= 500 &&
    threadId.startsWith(`${userId}:${agentId}:`) &&
    threadId.length > `${userId}:${agentId}:`.length
  );
}

export function createChatAgents(mastra: Mastra, request: Request) {
  const resourceId = `staff:${request.headers.get("x-cyphersoft-user-id")}`;
  return Object.fromEntries(
    CHAT_AGENTS.map((agentId, index) => [
      agentId,
      new MastraAgent({
        agentId,
        agent: mastra.getAgent(AGENT_KEYS[index]),
        resourceId,
        requestContext: chatRequestContext(request),
      }),
    ]),
  );
}

export async function serveCopilotRequest(
  mastra: Mastra,
  request: Request,
  secret: string | undefined,
) {
  const status = authorizeCopilotRequest(request, secret);
  if (status !== 200)
    return new Response(
      status === 503
        ? "Assistant connection is not configured."
        : "Unauthorized",
      { status },
    );
  const payload = await request
    .clone()
    .json()
    .catch(() => null);
  if (
    !authorizeCopilotOperation(
      request.headers.get("x-cyphersoft-user-id")!,
      payload,
    )
  ) {
    return new Response(
      "This assistant operation or conversation is not available.",
      { status: 403 },
    );
  }
  const runtime = new CopilotRuntime({
    agents: createChatAgents(mastra, request),
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/copilotkit",
    mode: "single-route",
    cors: false,
  });
  return handler(cleanRuntimeRequest(request));
}

export const copilotkitRoute = registerApiRoute("/copilotkit", {
  method: "POST",
  handler: async (context) => {
    return serveCopilotRequest(
      context.get("mastra"),
      context.req.raw,
      process.env.MASTRA_COPILOTKIT_SERVICE_TOKEN,
    );
  },
});
