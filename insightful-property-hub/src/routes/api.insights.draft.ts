import { createFileRoute } from "@tanstack/react-router";
import { authedClient, getRequestUser } from "../lib/server-auth";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Staff-only: drafts an insight with the Mastra `insight-drafter-agent` from APPROVED facts
// (lease terms, property, approved document fields) read from Convex as the calling user.
// The draft is returned to the browser; staff save, edit and publish it through Convex.

const MASTRA_API_URL =
  process.env.MASTRA_API_URL ??
  (process.env.MASTRA_CHAT_URL
    ? process.env.MASTRA_CHAT_URL.replace(/\/chat\/?$/, "")
    : "http://localhost:4111");

const CATEGORIES = new Set(["renewal", "cost", "document", "market", "risk", "other"]);
const PRIORITIES = new Set(["low", "medium", "high", "critical"]);

type DraftRequest = { documentId?: string; leaseId?: string; focus?: string };

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function parseDraft(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const str = (value: unknown, max: number) =>
      typeof value === "string" ? value.trim().slice(0, max) : "";
    const title = str(data.title, 200);
    const body = str(data.body, 4000);
    if (!title || !body) return null;
    return {
      title,
      body,
      recommendedAction: str(data.recommendedAction, 500) || undefined,
      category: CATEGORIES.has(String(data.category)) ? String(data.category) : "other",
      priority: PRIORITIES.has(String(data.priority)) ? String(data.priority) : "medium",
    };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/insights/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getRequestUser(request);
        const convex = authedClient(request);
        if (!user?.isStaff || !convex) {
          return json({ error: "Sign in with a Cyphersoft staff account." }, 401);
        }

        const input = (await request.json().catch(() => ({}))) as DraftRequest;
        if (!input.documentId && !input.leaseId) {
          return json({ error: "Choose a document or lease to draft from." }, 400);
        }

        const facts: string[] = [`Today: ${new Date().toISOString().slice(0, 10)}`];
        let tenantId: string | null = null;
        let propertyId: string | null = null;
        let leaseId: string | null = input.leaseId ?? null;
        const documentIds: string[] = [];

        if (input.documentId) {
          const document = await convex.query(api.documents.get, {
            documentId: input.documentId as Id<"documents">,
          });
          if (!document) return json({ error: "Document not found." }, 404);
          tenantId = document.tenantId;
          propertyId = document.property?.propertyId ?? null;
          documentIds.push(document._id);
          facts.push(`Client: ${document.client.name}`);
          facts.push(
            `Source document: ${document.filename} (${document.documentType ?? "unclassified"})`,
          );
          if (document.property) facts.push(`Property: ${document.property.name}`);
          const approved = document.fields.filter((field) => field.state === "approved");
          if (approved.length === 0) {
            return json(
              { error: "Approve some extracted fields first; drafts use approved values only." },
              400,
            );
          }
          for (const field of approved) facts.push(`${field.label}: ${field.value}`);
          if (document.missingFields.length) {
            facts.push(`Not found in the document: ${document.missingFields.join(", ")}`);
          }
        }

        if (!leaseId && propertyId) {
          const property = await convex.query(api.properties.get, {
            propertyId: propertyId as Id<"properties">,
          });
          leaseId = property?.currentLease?.leaseId ?? null;
        }
        if (leaseId) {
          const lease = await convex.query(api.leases.get, { leaseId: leaseId as Id<"leases"> });
          if (lease) {
            tenantId = tenantId ?? lease.tenantId;
            propertyId = propertyId ?? lease.property?.propertyId ?? null;
            facts.push(`Client: ${lease.client.name}`);
            if (lease.property)
              facts.push(`Property: ${lease.property.name}, ${lease.property.city}`);
            facts.push(`Lease term: ${lease.startDate} to ${lease.endDate}`);
            facts.push(`Monthly rental: R ${lease.monthlyRental}`);
            if (lease.escalationPercent !== undefined)
              facts.push(`Annual escalation: ${lease.escalationPercent}%`);
            if (lease.noticePeriodMonths !== undefined)
              facts.push(`Notice period: ${lease.noticePeriodMonths} months`);
            if (lease.breakClause) facts.push(`Break clause: ${lease.breakClause}`);
            if (lease.renewalOption) facts.push(`Renewal option: ${lease.renewalOption}`);
            facts.push(
              `Lease status: ${lease.status}; renewal horizon ${lease.renewalHorizonDays} days`,
            );
            if (lease.sourceDocumentId && !documentIds.includes(lease.sourceDocumentId)) {
              documentIds.push(lease.sourceDocumentId);
            }
          }
        }
        if (!tenantId) return json({ error: "Nothing to draft from." }, 400);
        if (input.focus) facts.push(`Staff asked to focus on: ${input.focus.slice(0, 300)}`);

        let upstream: Response;
        try {
          upstream = await fetch(`${MASTRA_API_URL}/api/agents/insight-drafter-agent/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: `Facts:\n${[...new Set(facts)].join("\n")}` }],
            }),
            signal: request.signal,
          });
        } catch {
          return json(
            {
              error:
                "The Cyphersoft Assistant service is not reachable. Start Mastra and try again.",
            },
            503,
          );
        }
        if (!upstream.ok) {
          return json(
            { error: `The assistant could not draft an insight (${upstream.status}).` },
            502,
          );
        }
        const result = (await upstream.json()) as { text?: string };
        const draft = parseDraft(result.text ?? "");
        if (!draft)
          return json({ error: "The assistant returned an unusable draft. Try again." }, 502);

        return json({ draft, tenantId, propertyId, leaseId, documentIds });
      },
    },
  },
});
