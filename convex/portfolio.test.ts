/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ADMIN_EMAIL = "admin@cyphersoft.test";

async function setup() {
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) => ctx.db.insert("users", { email: ADMIN_EMAIL, name: "Admin" }));
  // Convex Auth identities carry "userId|sessionId" as the subject.
  const asUser = (userId: string) => t.withIdentity({ subject: `${userId}|session` });
  const admin = asUser(adminId);

  const acme = await admin.mutation(api.clients.create, {
    name: "Acme Logistics",
    slug: "acme",
    primaryContactName: "Ann Client",
    primaryContactEmail: "ann@acme.test",
    inviteContactAsAdmin: true,
  });
  const other = await admin.mutation(api.clients.create, {
    name: "Other Co",
    slug: "other",
    primaryContactName: "Olu Other",
    primaryContactEmail: "olu@other.test",
    inviteContactAsAdmin: false,
  });

  // Ann signs up with the invited email and accepts the invitation.
  const annId = await t.run((ctx) => ctx.db.insert("users", { email: "ann@acme.test", name: "Ann" }));
  const ann = asUser(annId);
  await ann.mutation(api.users.syncCurrentUser, {});

  return { t, admin, ann, annId, adminId, acme, other, asUser };
}

describe("clients and portal access", () => {
  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });

  test("platform admin sees every client; invited client admin sees only their portal", async () => {
    const { admin, ann } = await setup();

    const clients = await admin.query(api.clients.list, {});
    expect(clients.map((client) => client.slug).sort()).toEqual(["acme", "other"]);

    const me = await ann.query(api.users.currentUser, {});
    expect(me?.isStaff).toBe(false);
    expect(me?.portals.map((portal) => portal.slug)).toEqual(["acme"]);

    expect((await ann.query(api.portal.getPortalContext, { slug: "acme" })).status).toBe("ok");
    expect((await ann.query(api.portal.getPortalContext, { slug: "other" })).status).toBe("forbidden");
    expect((await ann.query(api.portal.getPortalContext, { slug: "missing" })).status).toBe("not_found");

    // Client users are not staff, so staff-wide lists are refused.
    await expect(ann.query(api.clients.list, {})).rejects.toThrow(/staff access/);
  });

  test("staff create properties and leases; clients read only their own", async () => {
    const { admin, ann, acme, other } = await setup();

    const { propertyId } = await admin.mutation(api.properties.create, {
      tenantId: acme.tenantId,
      name: "Linbro DC",
      addressLine: "1 Main Rd",
      city: "Johannesburg",
      propertyType: "logistics",
      status: "active",
      sizeSqm: 1000,
      features: ["Docks"],
    });
    await admin.mutation(api.leases.create, {
      propertyId,
      startDate: "2024-01-01",
      endDate: "2029-01-01",
      monthlyRental: 100000,
      status: "active",
    });
    await admin.mutation(api.properties.create, {
      tenantId: other.tenantId,
      name: "Other HQ",
      addressLine: "2 Side St",
      city: "Cape Town",
      propertyType: "office",
      status: "active",
      features: [],
    });

    const annProperties = await ann.query(api.properties.list, { tenantId: acme.tenantId });
    expect(annProperties.map((property) => property.name)).toEqual(["Linbro DC"]);
    expect(annProperties[0].currentLease?.monthlyRental).toBe(100000);

    await expect(ann.query(api.properties.list, { tenantId: other.tenantId })).rejects.toThrow(/access/);
    await expect(
      ann.mutation(api.properties.create, {
        tenantId: acme.tenantId,
        name: "Sneaky",
        addressLine: "x",
        city: "y",
        propertyType: "office",
        status: "active",
        features: [],
      }),
    ).rejects.toThrow(/staff/);

    const clients = await admin.query(api.clients.list, {});
    const acmeRow = clients.find((client) => client.slug === "acme");
    expect(acmeRow?.annualRental).toBe(1200000);
    expect(acmeRow?.leaseCount).toBe(1);
  });

  test("lease validation rejects an end date before the start date", async () => {
    const { admin, acme } = await setup();
    const { propertyId } = await admin.mutation(api.properties.create, {
      tenantId: acme.tenantId,
      name: "P",
      addressLine: "a",
      city: "c",
      propertyType: "office",
      status: "active",
      features: [],
    });
    await expect(
      admin.mutation(api.leases.create, {
        propertyId,
        startDate: "2026-01-01",
        endDate: "2025-01-01",
        monthlyRental: 1,
        status: "active",
      }),
    ).rejects.toThrow(/after the start date/);
  });

  test("team rules: no self-revoke, and a revoked user is reactivated when re-invited", async () => {
    const { t, admin, ann, annId, acme } = await setup();
    const workspace = await ann.query(api.portal.getPortalTeamWorkspace, { slug: "acme" });
    expect(workspace?.canManageTeam).toBe(true);
    const annMembership = workspace!.members.find((member) => member.userId === annId)!;

    await expect(
      ann.mutation(api.portal.revokePortalMember, { membershipId: annMembership.membershipId as never }),
    ).rejects.toThrow(/own access/);

    await admin.mutation(api.portal.revokePortalMember, { membershipId: annMembership.membershipId as never });
    expect((await ann.query(api.portal.getPortalContext, { slug: "acme" })).status).toBe("forbidden");

    await admin.mutation(api.portal.invitePortalMember, {
      slug: "acme",
      email: "ann@acme.test",
      roleKey: "property_manager",
    });
    await ann.mutation(api.users.syncCurrentUser, {});
    expect((await ann.query(api.portal.getPortalContext, { slug: "acme" })).status).toBe("ok");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_tenantId_and_userId", (q) => q.eq("tenantId", acme.tenantId).eq("userId", annId))
        .collect(),
    );
    // Reactivated in place: still a single membership row.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].roleKey).toBe("property_manager");
  });

  test("a non-manager sees the team page without member data", async () => {
    const { admin, asUser, t } = await setup();
    await admin.mutation(api.portal.invitePortalMember, {
      slug: "acme",
      email: "viewer@acme.test",
      roleKey: "executive_viewer",
    });
    const viewerId = await t.run((ctx) => ctx.db.insert("users", { email: "viewer@acme.test" }));
    const viewer = asUser(viewerId);
    await viewer.mutation(api.users.syncCurrentUser, {});
    const workspace = await viewer.query(api.portal.getPortalTeamWorkspace, { slug: "acme" });
    expect(workspace?.canManageTeam).toBe(false);
    expect(workspace?.members).toEqual([]);
  });
});
