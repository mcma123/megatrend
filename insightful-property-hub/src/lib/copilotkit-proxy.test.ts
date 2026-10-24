import { describe, expect, it, vi } from "vitest";
import { proxyCopilotRequest } from "./copilotkit-proxy.server";

function request(body = '{"method":"info"}', signal?: AbortSignal) {
  return new Request("http://portal/api/copilotkit", {
    method: "POST",
    body,
    signal,
    headers: {
      Authorization: "Bearer convex-token",
      "X-Cyphersoft-User-Id": "forged",
      "X-Cyphersoft-Model": "openai/gpt-4.1-mini",
      "X-Cyphersoft-Images": "true",
      Cookie: "private-cookie",
    },
  });
}

describe("CopilotKit staff proxy", () => {
  it("blocks anonymous and client users before contacting Mastra", async () => {
    const fetcher = vi.fn();
    for (const user of [null, { _id: "client", isStaff: false }]) {
      expect(
        (
          await proxyCopilotRequest(request(), {
            getUser: async () => user,
            secret: "service-secret",
            baseUrl: "http://mastra",
            fetcher,
          })
        ).status,
      ).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed without service configuration and rejects invalid JSON", async () => {
    const getUser = async () => ({ _id: "staff123", isStaff: true });
    expect(
      (await proxyCopilotRequest(request(), { getUser, baseUrl: "http://mastra" })).status,
    ).toBe(503);
    expect(
      (
        await proxyCopilotRequest(request("invalid"), {
          getUser,
          baseUrl: "http://mastra",
          secret: "secret",
        })
      ).status,
    ).toBe(400);
  });
  it("streams results, replaces caller identity, isolates headers and propagates cancellation", async () => {
    const abort = new AbortController();
    const incoming = request(undefined, abort.signal);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("data: event\n\n", {
        headers: { "content-type": "text/event-stream", "set-cookie": "secret" },
      }),
    );
    const response = await proxyCopilotRequest(incoming, {
      getUser: async () => ({ _id: "staff123", isStaff: true }),
      secret: "service-secret",
      baseUrl: "http://mastra/",
      fetcher,
    });
    expect(await response.text()).toBe("data: event\n\n");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("http://mastra/copilotkit");
    expect(options?.signal).toBe(incoming.signal);
    expect(options?.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer service-secret",
      "X-Cyphersoft-User-Id": "staff123",
      "X-Cyphersoft-Model": "openai/gpt-4.1-mini",
      "X-Cyphersoft-Images": "true",
    });
  });
  it("does not expose upstream failures or credentials", async () => {
    const response = await proxyCopilotRequest(request(), {
      getUser: async () => ({ _id: "staff123", isStaff: true }),
      secret: "service-secret",
      baseUrl: "http://mastra",
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private upstream secret", { status: 500 })),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret");
  });
});
