/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  canonicalListingUrl,
  normalizeCandidates,
  sourcingResultSchema,
  type SourcingCandidate,
} from "./lib/sourcing";
import {
  boundSourcingEvidence,
  collectSourcingEvidence,
  researchProperties,
} from "../src/mastra/application/web-research/property-sourcing-service";
import type { Agent } from "@mastra/core/agent";
import { propertySourcingRoute } from "../src/mastra/routes/property-sourcing";

const modules = import.meta.glob("./**/*.ts");
const input = {
  propertyType: "logistics" as const,
  location: "Linbro Park",
  sizeSqm: 10000,
  notes: "ESFR sprinklers required",
};
const candidate: SourcingCandidate = {
  name: "Linbro Warehouse",
  propertyType: "warehouse",
  sourceUrl: "https://listings.test/warehouse/1",
  location: "Linbro Park, Johannesburg",
  sizeSqm: 10000,
  rentalPerSqm: null,
  monthlyRental: null,
  features: ["Loading docks"],
  typeEvidence: "Warehouse to let",
  rentalEvidence: "To let",
  logisticsUseEvidence: "Ideal for logistics distribution",
  unverifiedRequirements: ["ESFR sprinklers"],
  matchScore: 85,
  matchExplanation: "Suitable logistics location and size; ESFR is not stated.",
};

async function setup() {
  vi.useFakeTimers();
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "sourcing-admin@test.local");
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "sourcing-admin@test.local" }),
  );
  const admin = t.withIdentity({ subject: `${adminId}|session` });
  const client = await admin.mutation(api.clients.create, {
    name: "Sourcing Client",
    slug: "sourcing-client",
    primaryContactName: "Client",
    primaryContactEmail: "client@test.local",
    inviteContactAsAdmin: false,
  });
  const other = await admin.mutation(api.clients.create, {
    name: "Other Client",
    slug: "other-client",
    primaryContactName: "Other",
    primaryContactEmail: "other@test.local",
    inviteContactAsAdmin: false,
  });
  async function member(
    principalType: "staff" | "client",
    roleKey:
      "tenant_admin" | "read_only_staff" | "executive_viewer" | "client_admin",
  ) {
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        email: `${roleKey}@test.local`,
      });
      await ctx.db.insert("memberships", {
        tenantId: client.tenantId,
        userId: id,
        principalType,
        roleKey,
        status: "active",
        createdAt: Date.now(),
        createdBy: adminId,
      });
      return id;
    });
    return t.withIdentity({ subject: `${userId}|session` });
  }
  return { t, admin, client, other, member };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("saved sourcing briefs", () => {
  test("creates an immutable brief, deduplicates the same request, and schedules work once", async () => {
    const { t, admin, client } = await setup();
    const args = {
      ...input,
      tenantId: client.tenantId,
      requestId: "request-123",
    };
    const id = await admin.mutation(api.sourcing.create, args);
    expect(await admin.mutation(api.sourcing.create, args)).toBe(id);
    await expect(
      admin.mutation(api.sourcing.create, { ...args, propertyType: "office" }),
    ).rejects.toThrow(/another brief/);
    const brief = await admin.query(api.sourcing.get, { briefId: id });
    expect(brief).toMatchObject({ ...input, status: "queued", candidates: [] });
    expect(
      (await admin.query(api.sourcing.list, { tenantId: client.tenantId }))
        .briefs,
    ).toHaveLength(1);
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toHaveLength(2);
  });

  test("staff can only access assigned tenants; clients and read-only roles cannot create", async () => {
    const { admin, client, other, member } = await setup();
    const staff = await member("staff", "tenant_admin");
    const reader = await member("staff", "read_only_staff");
    const executive = await member("staff", "executive_viewer");
    const customer = await member("client", "client_admin");
    const args = {
      ...input,
      tenantId: client.tenantId,
      requestId: "permission-123",
    };
    const id = await staff.mutation(api.sourcing.create, args);
    expect(
      (await reader.query(api.sourcing.list, { tenantId: client.tenantId }))
        .canCreate,
    ).toBe(false);
    expect(
      (await executive.query(api.sourcing.list, { tenantId: client.tenantId }))
        .canCreate,
    ).toBe(false);
    for (const caller of [reader, executive, customer])
      await expect(
        caller.mutation(api.sourcing.create, {
          ...args,
          requestId: "blocked-123",
        }),
      ).rejects.toThrow(/role|staff/);
    await expect(
      customer.query(api.sourcing.get, { briefId: id }),
    ).rejects.toThrow(/staff/);
    await expect(
      customer.query(api.sourcing.list, { tenantId: client.tenantId }),
    ).rejects.toThrow(/staff/);
    const otherId = await admin.mutation(api.sourcing.create, {
      ...args,
      tenantId: other.tenantId,
    });
    await expect(
      staff.query(api.sourcing.get, { briefId: otherId }),
    ).rejects.toThrow(/access/);
    await expect(
      staff.mutation(api.sourcing.create, {
        ...args,
        tenantId: other.tenantId,
      }),
    ).rejects.toThrow(/access/);
  });

  test("validates filters and rejects empty locations, invalid sizes and types", async () => {
    const { admin, client } = await setup();
    const args = {
      ...input,
      tenantId: client.tenantId,
      requestId: "invalid-123",
    };
    for (const change of [
      { location: " " },
      { sizeSqm: 0 },
      { propertyType: "other" },
      { notes: "x".repeat(2001) },
    ]) {
      await expect(
        admin.mutation(api.sourcing.create, { ...args, ...change }),
      ).rejects.toThrow(/Choose a property/);
    }
  });

  test("late and repeated completion cannot replace another brief or duplicate candidates", async () => {
    const { t, admin, client } = await setup();
    const older = await admin.mutation(api.sourcing.create, {
      ...input,
      tenantId: client.tenantId,
      requestId: "older-123",
    });
    const newer = await admin.mutation(api.sourcing.create, {
      ...input,
      propertyType: "office",
      tenantId: client.tenantId,
      requestId: "newer-123",
    });
    expect(
      await t.mutation(internal.sourcing.claim, { briefId: older }),
    ).not.toBeNull();
    expect(
      await t.mutation(internal.sourcing.claim, { briefId: older }),
    ).toBeNull();
    await t.mutation(internal.sourcing.finish, {
      briefId: older,
      result: {
        candidates: [
          candidate,
          { ...candidate, sourceUrl: `${candidate.sourceUrl}?utm_source=test` },
        ],
        warnings: [],
      },
    });
    await t.mutation(internal.sourcing.finish, {
      briefId: older,
      result: { candidates: [], warnings: [] },
    });
    await t.mutation(internal.sourcing.fail, {
      briefId: older,
      error: "Late failure",
    });
    expect(
      (await admin.query(api.sourcing.get, { briefId: older }))?.candidates,
    ).toHaveLength(1);
    expect(
      (await admin.query(api.sourcing.get, { briefId: older }))?.status,
    ).toBe("completed");
    expect(
      (await admin.query(api.sourcing.get, { briefId: newer }))?.status,
    ).toBe("queued");
  });

  test("empty results complete, invalid output fails validation, and expired briefs reject late results", async () => {
    const { t, admin, client } = await setup();
    const id = await admin.mutation(api.sourcing.create, {
      ...input,
      tenantId: client.tenantId,
      requestId: "empty-123",
    });
    await t.mutation(internal.sourcing.claim, { briefId: id });
    await expect(
      t.mutation(internal.sourcing.finish, {
        briefId: id,
        result: { candidates: [{ name: "bad" }], warnings: [] },
      }),
    ).rejects.toThrow(/Invalid sourcing/);
    await t.mutation(internal.sourcing.finish, {
      briefId: id,
      result: { candidates: [], warnings: [] },
    });
    expect((await admin.query(api.sourcing.get, { briefId: id }))?.status).toBe(
      "completed",
    );
    const expired = await admin.mutation(api.sourcing.create, {
      ...input,
      tenantId: client.tenantId,
      requestId: "expire-123",
    });
    await t.mutation(internal.sourcing.claim, { briefId: expired });
    await t.mutation(internal.sourcing.expire, { briefId: expired });
    await t.mutation(internal.sourcing.finish, {
      briefId: expired,
      result: { candidates: [candidate], warnings: [] },
    });
    expect(
      await admin.query(api.sourcing.get, { briefId: expired }),
    ).toMatchObject({ status: "failed", candidates: [] });
  });

  test("the processor sends saved filters to Mastra and stores results", async () => {
    const { t, admin, client } = await setup();
    vi.stubEnv("MASTRA_SOURCING_URL", "https://mastra.test/sourcing/research");
    vi.stubEnv("MASTRA_SOURCING_SERVICE_TOKEN", "test-service-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ candidates: [candidate], warnings: [] }),
      );
    const id = await admin.mutation(api.sourcing.create, {
      ...input,
      tenantId: client.tenantId,
      requestId: "processor-123",
    });
    await t.action(internal.sourcing.runResearch, { briefId: id });
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual(input);
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer test-service-token",
    });
    expect(await admin.query(api.sourcing.get, { briefId: id })).toMatchObject({
      status: "completed",
      candidates: [{ propertyType: "warehouse", monthlyRental: null }],
    });
    await t.action(internal.sourcing.runResearch, { briefId: id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each(["unconfigured", "unreachable", "malformed", "unauthorized"])(
    "processor records a safe failure when %s",
    async (failure) => {
      const { t, admin, client } = await setup();
      vi.stubEnv(
        "MASTRA_SOURCING_URL",
        failure === "unconfigured"
          ? ""
          : "https://mastra.test/sourcing/research",
      );
      vi.stubEnv("MASTRA_SOURCING_SERVICE_TOKEN", "test-service-token");
      const fetchMock = vi.spyOn(globalThis, "fetch");
      if (failure === "unreachable")
        fetchMock.mockRejectedValue(new Error("secret upstream information"));
      else
        fetchMock.mockResolvedValue(
          failure === "unauthorized"
            ? new Response("secret", { status: 401 })
            : Response.json({ candidates: "bad" }),
        );
      const id = await admin.mutation(api.sourcing.create, {
        ...input,
        tenantId: client.tenantId,
        requestId: `failure-${failure}`,
      });
      await t.action(internal.sourcing.runResearch, { briefId: id });
      const result = await admin.query(api.sourcing.get, { briefId: id });
      expect(result?.status).toBe("failed");
      expect(result?.error).not.toContain("secret");
      expect(result?.candidates).toEqual([]);
    },
  );
});

describe("source-backed property research", () => {
  test("research endpoint fails closed and validates authenticated inputs before calling the agent", async () => {
    if (!("handler" in propertySourcingRoute))
      throw new Error("Missing sourcing handler");
    const handler = propertySourcingRoute.handler as (
      context: unknown,
    ) => Promise<Response>;
    const getAgent = vi.fn();
    const context = (authorization: string, body: unknown = input) => ({
      req: {
        header: () => authorization,
        json: async () => body,
        raw: new Request("https://mastra.test/sourcing/research"),
      },
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      get: () => ({ getAgent }),
    });
    vi.stubEnv("MASTRA_SOURCING_SERVICE_TOKEN", "");
    expect((await handler(context(""))).status).toBe(503);
    vi.stubEnv("MASTRA_SOURCING_SERVICE_TOKEN", "test-token");
    expect((await handler(context(""))).status).toBe(401);
    expect((await handler(context("Bearer incorrect"))).status).toBe(401);
    expect(
      (
        await handler(
          context("Bearer test-token", { ...input, propertyType: "invalid" }),
        )
      ).status,
    ).toBe(400);
    expect(getAgent).not.toHaveBeenCalled();
    getAgent.mockReturnValue({
      generate: vi.fn().mockRejectedValue(new Error("secret provider details")),
    });
    const response = await handler(context("Bearer test-token"));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret provider");
    expect(getAgent).toHaveBeenCalledWith("webResearchAgent");
    getAgent.mockReturnValue({
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          steps: [
            {
              toolCalls: [],
              toolResults: [
                {
                  payload: {
                    toolCallId: "search",
                    toolName: "windmill_firecrawl_search",
                    result: { success: true, results: [] },
                  },
                },
              ],
            },
          ],
        })
        .mockResolvedValueOnce({ object: { candidates: [], warnings: [] } }),
    });
    const empty = await handler(context("Bearer test-token"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({
      candidates: [],
      warnings: ["No individual listing pages could be verified."],
    });
  });

  test.each(["office", "logistics", "warehouse", "retail"] as const)(
    "filters %s strictly, with only the agreed Logistics exception",
    (type) => {
      const variants = [
        "office",
        "logistics",
        "warehouse",
        "retail",
        "distribution",
        "industrial",
        "other",
      ] as const;
      const results = normalizeCandidates(
        type,
        variants.map((propertyType) => ({
          ...candidate,
          propertyType,
          sourceUrl: `https://listings.test/${propertyType}`,
        })),
      );
      expect(results.map((result) => result.propertyType).sort()).toEqual(
        type === "logistics"
          ? ["distribution", "logistics", "warehouse"]
          : [type],
      );
      expect(
        normalizeCandidates("logistics", [
          { ...candidate, logisticsUseEvidence: null },
        ]),
      ).toEqual([]);
    },
  );

  test("URL validation, source provenance, ranking and deduplication", () => {
    expect(canonicalListingUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalListingUrl("https://user:pass@listings.test/a")).toBeNull();
    const candidates = [
      candidate,
      {
        ...candidate,
        matchScore: 95,
        sourceUrl: `${candidate.sourceUrl}/?utm_source=test#gallery`,
      },
      { ...candidate, sourceUrl: "https://invented.test/a" },
    ];
    expect(
      normalizeCandidates(
        "logistics",
        candidates,
        new Set([candidate.sourceUrl]),
      ),
    ).toHaveLength(1);
    expect(
      normalizeCandidates(
        "logistics",
        candidates,
        new Set([candidate.sourceUrl]),
      )[0].matchScore,
    ).toBe(95);
    expect(
      sourcingResultSchema.parse({ candidates: [candidate], warnings: [] })
        .candidates[0].rentalPerSqm,
    ).toBeNull();
  });

  test("requires successful search execution and records only successful scraped URLs", () => {
    const calls = [
      {
        payload: {
          toolCallId: "scrape",
          toolName: "windmill_firecrawl_scrape",
          args: { url: candidate.sourceUrl },
        },
      },
    ];
    const search = {
      payload: {
        toolCallId: "search",
        toolName: "windmill_firecrawl_search",
        result: { success: true, results: [] },
      },
    };
    expect(() => collectSourcingEvidence({ calls, results: [] })).toThrow(
      /No successful/,
    );
    expect(() =>
      collectSourcingEvidence({
        calls,
        results: [
          {
            ...search,
            payload: { ...search.payload, result: { success: false } },
          },
        ],
      }),
    ).toThrow(/No successful/);
    const evidence = collectSourcingEvidence({
      calls,
      results: [
        search,
        {
          payload: {
            toolCallId: "scrape",
            toolName: "windmill_firecrawl_scrape",
            result: { markdown: "Warehouse to let" },
          },
        },
      ],
    });
    expect([...evidence.sourceUrls]).toEqual([candidate.sourceUrl]);
    expect(
      collectSourcingEvidence({
        calls,
        results: [
          search,
          {
            payload: {
              toolCallId: "scrape",
              toolName: "windmill_firecrawl_scrape",
              isError: true,
              result: {},
            },
          },
        ],
      }).sourceUrls.size,
    ).toBe(0);
    expect(
      collectSourcingEvidence({
        calls,
        results: [
          search,
          {
            payload: {
              toolCallId: "scrape",
              toolName: "windmill_firecrawl_scrape",
              result: { success: true, markdown: null },
            },
          },
        ],
      }).sourceUrls.size,
    ).toBe(0);
  });

  test("oversized research evidence is shortened instead of failing the search", () => {
    const longPage = "Warehouse to let in Centurion. ".repeat(20_000);
    const sources = Array.from({ length: 12 }, (_, index) => ({
      tool: "windmill_firecrawl_scrape",
      input: { url: `https://listing.test/${index}` },
      result: { success: true, markdown: longPage },
    }));
    const bounded = boundSourcingEvidence(sources);
    expect(bounded.shortened).toBe(true);
    expect(bounded.text.length).toBeLessThanOrEqual(200_000);
    const kept = JSON.parse(bounded.text) as { result: { markdown: string; markdownTruncated?: boolean } }[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0].result.markdown.startsWith("Warehouse to let in Centurion.")).toBe(true);
    expect(kept[0].result.markdownTruncated).toBe(true);

    const small = boundSourcingEvidence([sources[0]].map((source) => ({
      ...source,
      result: { success: true, markdown: "Short page" },
    })));
    expect(small.shortened).toBe(false);
  });

  test("agent searches with all filters, structures evidence, and drops invented sources", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        steps: [
          {
            toolCalls: [
              {
                payload: {
                  toolCallId: "scrape",
                  toolName: "windmill_firecrawl_scrape",
                  args: { url: candidate.sourceUrl },
                },
              },
            ],
            toolResults: [
              {
                payload: {
                  toolCallId: "search",
                  toolName: "windmill_firecrawl_search",
                  result: { success: true },
                },
              },
              {
                payload: {
                  toolCallId: "scrape",
                  toolName: "windmill_firecrawl_scrape",
                  result: {
                    markdown:
                      "Warehouse to let. Ideal for logistics distribution.",
                  },
                },
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        object: {
          candidates: [
            candidate,
            { ...candidate, sourceUrl: "https://invented.test/property" },
          ],
          warnings: [],
        },
      });
    const result = await researchProperties(
      { generate } as unknown as Agent,
      input,
      new AbortController().signal,
    );
    expect(generate.mock.calls[0][0]).toContain(JSON.stringify(input));
    expect(generate.mock.calls[1][1].toolChoice).toBe("none");
    expect(result.candidates).toHaveLength(1);
    expect(result.warnings).toContain(
      "Unverified, duplicate or unrelated listings were excluded.",
    );
  });
});
