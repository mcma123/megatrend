import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { listStaffTenants, requireStaff } from "./lib/auth";
import { getClientLabel } from "./lib/portfolio";

// Staff-wide full-text search across clients, properties, leases (via their property) and
// documents (filename and extracted text preview). Platform admins search every tenant;
// other staff only the tenants they belong to.

const PER_KIND = 10;

export const global = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const term = args.q.trim().slice(0, 200);
    if (term.length < 2) {
      return { clients: [], properties: [], leases: [], documents: [] };
    }
    const tenants = await listStaffTenants(ctx, staff);
    const allowed = new Set<Id<"tenants">>(tenants.map((tenant) => tenant._id));
    // Platform admins: one unfiltered search; others: per-tenant filtered searches.
    const scopes: Array<Id<"tenants"> | null> = staff.isPlatformAdmin ? [null] : tenants.map((tenant) => tenant._id);

    const organizations: Doc<"organizations">[] = [];
    const properties: Doc<"properties">[] = [];
    const byFilename: Doc<"documents">[] = [];
    const byText: Doc<"documents">[] = [];
    for (const scope of scopes) {
      organizations.push(
        ...(await ctx.db
          .query("organizations")
          .withSearchIndex("search_name", (q) => (scope ? q.search("name", term).eq("tenantId", scope) : q.search("name", term)))
          .take(PER_KIND)),
      );
      properties.push(
        ...(await ctx.db
          .query("properties")
          .withSearchIndex("search_name", (q) => (scope ? q.search("name", term).eq("tenantId", scope) : q.search("name", term)))
          .take(PER_KIND)),
      );
      byFilename.push(
        ...(await ctx.db
          .query("documents")
          .withSearchIndex("search_filename", (q) =>
            scope ? q.search("filename", term).eq("tenantId", scope) : q.search("filename", term),
          )
          .take(PER_KIND)),
      );
      byText.push(
        ...(await ctx.db
          .query("documents")
          .withSearchIndex("search_text", (q) =>
            scope ? q.search("textPreview", term).eq("tenantId", scope) : q.search("textPreview", term),
          )
          .take(PER_KIND)),
      );
    }

    const clients = [];
    for (const organization of organizations.filter((row) => allowed.has(row.tenantId)).slice(0, PER_KIND)) {
      const tenant = await ctx.db.get(organization.tenantId);
      if (tenant) clients.push({ tenantId: tenant._id, slug: tenant.slug, name: organization.name, industry: organization.industry ?? null });
    }

    const propertyRows = [];
    const leaseRows = [];
    for (const property of properties.filter((row) => allowed.has(row.tenantId) && !row.archivedAt).slice(0, PER_KIND)) {
      const client = await getClientLabel(ctx, property.tenantId);
      propertyRows.push({ propertyId: property._id, name: property.name, city: property.city, client });
      const leases = await ctx.db
        .query("leases")
        .withIndex("by_propertyId", (q) => q.eq("propertyId", property._id))
        .take(10);
      for (const lease of leases) {
        if (lease.archivedAt) continue;
        leaseRows.push({
          leaseId: lease._id,
          propertyName: property.name,
          client,
          startDate: lease.startDate,
          endDate: lease.endDate,
          monthlyRental: lease.monthlyRental,
          status: lease.status,
        });
      }
    }

    const seen = new Set<Id<"documents">>();
    const documentRows = [];
    for (const [document, match] of [
      ...byFilename.map((document) => [document, "filename"] as const),
      ...byText.map((document) => [document, "content"] as const),
    ]) {
      if (seen.has(document._id) || !allowed.has(document.tenantId) || document.deletedAt || document.replacedByDocumentId) continue;
      seen.add(document._id);
      const preview = document.textPreview ?? "";
      const index = preview.toLowerCase().indexOf(term.toLowerCase().split(/\s+/)[0] ?? "");
      documentRows.push({
        documentId: document._id,
        filename: document.filename,
        client: await getClientLabel(ctx, document.tenantId),
        documentType: document.documentType ?? document.declaredType ?? null,
        status: document.status,
        match,
        snippet: index >= 0 ? preview.slice(Math.max(0, index - 60), index + 140).replace(/\s+/g, " ").trim() : null,
      });
      if (documentRows.length >= PER_KIND * 2) break;
    }

    return { clients, properties: propertyRows, leases: leaseRows.slice(0, PER_KIND * 2), documents: documentRows };
  },
});
