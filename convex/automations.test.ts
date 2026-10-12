/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_EMAIL = "admin@cyphersoft.test";
const DAY = 86_400_000;

function isoInDays(days: number) {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

async function setup() {
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  const t = convexTest(schema, modules);
  const asUser = (userId: string) => t.withIdentity({ subject: `${userId}|session` });
  const adminId = await t.run((ctx) => ctx.db.insert("users", { email: ADMIN_EMAIL, name: "Admin" }));
  const admin = asUser(adminId);
  const acme = await admin.mutation(api.clients.create, {
    name: "Acme",
    slug: "acme",
    primaryContactName: "Ann",
    primaryContactEmail: "ann@acme.test",
    inviteContactAsAdmin: true,
  });
  const annId = await t.run((ctx) => ctx.db.insert("users", { email: "ann@acme.test", name: "Ann" }));
  const ann = asUser(annId);
  await ann.mutation(api.users.syncCurrentUser, {});

  async function leaseEndingIn(days: number, name: string) {
    const { propertyId } = await admin.mutation(api.properties.create, {
      tenantId: acme.tenantId,
      name,
      addressLine: "1 Main Rd",
      city: "Johannesburg",
      propertyType: "office",
      status: "active",
      features: [],
    });
    const { leaseId } = await admin.mutation(api.leases.create, {
      propertyId,
      startDate: "2021-01-01",
      endDate: isoInDays(days),
      monthlyRental: 50000,
      status: "active",
    });
    return leaseId;
  }

  return { t, admin, ann, acme, leaseEndingIn };
}

describe("renewal cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => vi.useRealTimers());

  test("a lease entering its renewal window gets the T-180 action, notifications and a draft insight — once", async () => {
    const { t, admin, ann, acme, leaseEndingIn } = await setup();
    const leaseId = await leaseEndingIn(170, "Sandton Office");
    await leaseEndingIn(400, "Far Future Park");

    // Dry run first: nothing created.
    await admin.mutation(api.automations.simulate, { key: "renewal_cadence" });
    expect(await ann.query(api.actions.list, { tenantId: acme.tenantId })).toEqual([]);

    await t.mutation(internal.automations.runScheduled, { key: "renewal_cadence" });
    const clientActions = await ann.query(api.actions.list, { tenantId: acme.tenantId });
    expect(clientActions).toHaveLength(1);
    expect(clientActions[0]).toMatchObject({
      title: "Renewal window open: Sandton Office",
      status: "waiting_on_client",
      source: "automation",
    });
    const annInbox = await ann.query(api.notifications.mine, {});
    expect(annInbox.items.some((item) => item.kind === "renewal.step")).toBe(true);
    const adminInbox = await admin.query(api.notifications.mine, {});
    expect(adminInbox.items.some((item) => item.title.startsWith("T-180"))).toBe(true);
    const drafts = await admin.query(api.insights.list, { status: "draft" });
    expect(drafts.some((insight) => insight.leaseId === leaseId && insight.category === "renewal")).toBe(true);

    // Running again creates nothing new.
    await t.mutation(internal.automations.runScheduled, { key: "renewal_cadence" });
    expect(await ann.query(api.actions.list, { tenantId: acme.tenantId })).toHaveLength(1);

    const milestones = await admin.query(api.automations.leaseMilestones, { leaseId });
    expect(milestones).toEqual([expect.objectContaining({ daysBefore: 180, status: "fired" })]);

    const detail = await admin.query(api.automations.get, { key: "renewal_cadence" });
    expect(detail?.runs.map((run) => run.mode)).toEqual(["scheduled", "scheduled", "dry_run"]);
    expect(detail?.runs[2].stats.stepsFired).toBe(1);
  });

  test("catching up mid-window fires only the latest step and skips the older ones", async () => {
    const { t, admin, leaseEndingIn } = await setup();
    const leaseId = await leaseEndingIn(100, "Midrand DC");
    await t.mutation(internal.automations.runScheduled, { key: "renewal_cadence" });
    const milestones = await admin.query(api.automations.leaseMilestones, { leaseId });
    const byStep = Object.fromEntries(milestones.map((milestone) => [milestone.daysBefore, milestone.status]));
    expect(byStep).toEqual({ 180: "skipped", 150: "skipped", 120: "fired" });
    const tasks = await admin.query(api.actions.list, {});
    expect(tasks.map((task) => task.title)).toEqual(["Review briefing pack with client: Midrand DC"]);
  });

  test("disabled automations don't run on schedule; only platform admins can toggle", async () => {
    const { t, admin, ann, leaseEndingIn } = await setup();
    await leaseEndingIn(170, "Sandton Office");
    await expect(ann.mutation(api.automations.setEnabled, { key: "renewal_cadence", enabled: false })).rejects.toThrow();
    await admin.mutation(api.automations.setEnabled, { key: "renewal_cadence", enabled: false });
    await t.mutation(internal.automations.runScheduled, { key: "renewal_cadence" });
    expect(await admin.query(api.actions.list, {})).toEqual([]);
    const list = await admin.query(api.automations.list, {});
    expect(list.find((item) => item.key === "renewal_cadence")).toMatchObject({ enabled: false, runCount: 0 });
  });
});

describe("overdue reminders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => vi.useRealTimers());

  test("overdue client actions get one reminder per week", async () => {
    const { t, admin, ann, acme } = await setup();
    await admin.mutation(api.actions.create, {
      tenantId: acme.tenantId,
      title: "Upload the signed addendum",
      dueDate: isoInDays(-3),
      visibleToClient: true,
      status: "waiting_on_client",
    });
    const before = (await ann.query(api.notifications.mine, {})).items.length;
    await t.mutation(internal.automations.runScheduled, { key: "overdue_reminders" });
    await t.mutation(internal.automations.runScheduled, { key: "overdue_reminders" });
    const after = await ann.query(api.notifications.mine, {});
    expect(after.items.filter((item) => item.kind === "action.overdue_reminder")).toHaveLength(1);
    expect(after.items.length).toBe(before + 1);
  });
});
