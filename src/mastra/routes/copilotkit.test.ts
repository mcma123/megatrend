// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import type { Mastra } from "@mastra/core/mastra";
import {
  authorizeCopilotRequest,
  authorizeCopilotOperation,
  CHAT_AGENTS,
  chatRequestContext,
  cleanRuntimeRequest,
  createChatAgents,
  serveCopilotRequest,
} from "./copilotkit";
import { richOutputInstructions } from "../agents/rich-output-instructions";

function request(headers: Record<string, string> = {}) {
  return new Request("http://mastra/copilotkit", {
    method: "POST",
    body: '{"method":"info"}',
    headers: {
      Authorization: "Bearer service-secret",
      "X-Cyphersoft-User-Id": "staff123",
      "X-Cyphersoft-Model": "openai/gpt-4.1-mini",
      "X-Cyphersoft-Images": "true",
      ...headers,
    },
  });
}

describe("CopilotKit Mastra boundary", () => {
  it("binds run/connect/stop to the verified user and agent and blocks history controls", async () => {
    const payload = {
      method: "agent/run",
      params: { agentId: "web-research-agent" },
      body: { threadId: "staff123:web-research-agent:thread1" },
    };
    expect(authorizeCopilotOperation("staff123", payload)).toBe(true);
    expect(authorizeCopilotOperation("staff456", payload)).toBe(false);
    expect(
      authorizeCopilotOperation("staff123", {
        method: "agent/stop",
        params: {
          agentId: "web-research-agent",
          threadId: payload.body.threadId,
        },
      }),
    ).toBe(true);
    expect(
      authorizeCopilotOperation("staff123", {
        ...payload,
        method: "agent/stop",
        params: {
          agentId: "web-research-agent",
          threadId: "staff456:web-research-agent:other",
        },
      }),
    ).toBe(false);
    expect(
      authorizeCopilotOperation("staff456", {
        ...payload,
        method: "agent/connect",
      }),
    ).toBe(false);
    expect(
      authorizeCopilotOperation("staff123", {
        ...payload,
        params: { agentId: "okf-agent" },
      }),
    ).toBe(false);
    expect(
      authorizeCopilotOperation("staff123", { method: "threads/clear" }),
    ).toBe(false);
    const denied = await serveCopilotRequest(
      {} as Mastra,
      new Request("http://mastra/copilotkit", {
        method: "POST",
        headers: request().headers,
        body: JSON.stringify({ method: "threads/list" }),
      }),
      "service-secret",
    );
    expect(denied.status).toBe(403);
  });
  it("serves single-endpoint discovery without exposing non-chat agents", async () => {
    const fakeMastra = {
      getAgent: (id: string) =>
        new Agent({
          id,
          name: id,
          model: "openai/gpt-4.1-mini",
          instructions: "Test",
        }),
    } as unknown as Mastra;
    const response = await serveCopilotRequest(
      fakeMastra,
      request(),
      "service-secret",
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(Object.keys(JSON.parse(body).agents).sort()).toEqual([...CHAT_AGENTS].sort());
    for (const agent of CHAT_AGENTS) expect(body).toContain(agent);
    expect(body).not.toContain("voice-assistant");
    expect(body).not.toContain("insight-drafter");
    expect(body).not.toContain("service-secret");
  });
  it("fails closed and requires both the shared secret and trusted staff ID", () => {
    expect(authorizeCopilotRequest(request(), undefined)).toBe(503);
    expect(
      authorizeCopilotRequest(
        request({ Authorization: "Bearer wrong" }),
        "service-secret",
      ),
    ).toBe(401);
    expect(
      authorizeCopilotRequest(
        request({ "X-Cyphersoft-User-Id": "" }),
        "service-secret",
      ),
    ).toBe(401);
    expect(authorizeCopilotRequest(request(), "service-secret")).toBe(200);
  });
  it("removes auth and identity headers before runtime/provider forwarding", async () => {
    const incoming = request({ Cookie: "private", "X-Other": "private" });
    const clean = cleanRuntimeRequest(incoming);
    expect([...clean.headers.keys()].sort()).toEqual([
      "accept",
      "content-type",
    ]);
    expect(await clean.text()).toBe('{"method":"info"}');
    expect(clean.signal.aborted).toBe(false);
  });
  it("creates fresh contexts and enables presentation only for rich chat", () => {
    const a = chatRequestContext(request());
    const b = chatRequestContext(
      request({
        "X-Cyphersoft-Images": "false",
        "X-Cyphersoft-Model": "bad model",
      }),
    );
    expect(a).not.toBe(b);
    expect(a.get("selectedModel")).toBe("openai/gpt-4.1-mini");
    expect(a.get("includeImages")).toBe("true");
    expect(b.get("includeImages")).toBe("false");
    expect(b.get("selectedModel")).toBeUndefined();
    expect(richOutputInstructions()).toBe("");
    expect(richOutputInstructions(a)).toContain("show_comparison");
  });
  it("exposes exactly three chat agents with per-request identity and adapters", () => {
    const fakeMastra = {
      getAgent: (id: string) =>
        new Agent({
          id,
          name: id,
          model: "openai/gpt-4.1-mini",
          instructions: "Test",
        }),
    } as unknown as Mastra;
    const a = createChatAgents(fakeMastra, request());
    const b = createChatAgents(
      fakeMastra,
      request({ "X-Cyphersoft-User-Id": "staff456" }),
    );
    expect(Object.keys(a)).toEqual([...CHAT_AGENTS]);
    expect(a[CHAT_AGENTS[0]]).not.toBe(b[CHAT_AGENTS[0]]);
    expect(a[CHAT_AGENTS[0]].resourceId).toBe("staff:staff123");
    expect(b[CHAT_AGENTS[0]].resourceId).toBe("staff:staff456");
    expect(a[CHAT_AGENTS[0]].requestContext).not.toBe(
      b[CHAT_AGENTS[0]].requestContext,
    );
  });
});
