import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { env, type MutationCtx, type QueryCtx } from "../_generated/server";
import { policyBlockers, type SigningCategory } from "./signing";
import { keyring } from "./signingAccessCrypto";

export const releaseMode = v.union(v.literal("pilot"), v.literal("live"));
export type ReleaseMode = "pilot" | "live";
export const MAX_PILOT_RECIPIENTS = 50;

/** Deployment key. Anything other than an explicit "pilot"/"live" is off. */
export function deploymentReleaseMode(): ReleaseMode | "off" {
  const mode = (env.SIGNING_RELEASE_MODE ?? "").trim();
  return mode === "pilot" || mode === "live" ? mode : "off";
}

/** Service configuration presence only; acceptance evidence is attested on the release record. */
export function serviceBlockers() {
  const blockers: string[] = [];
  const missing = (label: string, ...values: (string | undefined)[]) => {
    if (values.some((value) => !value?.trim()))
      blockers.push(`${label} is not configured`);
  };
  try {
    keyring(env.SIGNING_ACCESS_KEYS_JSON, env.SIGNING_ACCESS_ACTIVE_KEY_ID);
  } catch {
    blockers.push("Signing access keys are not configured");
  }
  missing(
    "Signer portal origin and service token",
    env.SIGNING_PORTAL_ORIGIN,
    env.SIGNING_PORTAL_SERVICE_TOKEN,
  );
  missing("Signing sender address", env.SIGNING_SENDER_ADDRESS);
  missing(
    "Signing worker base URL and workspace",
    env.SIGNING_WINDMILL_BASE_URL,
    env.WINDMILL_WORKSPACE,
  );
  missing("Signing email worker token", env.WINDMILL_SIGNING_EMAIL_TOKEN);
  missing(
    "Signing document worker token",
    env.WINDMILL_SIGNING_DOCUMENTS_TOKEN,
  );
  missing("Finalisation worker token", env.WINDMILL_SIGNING_FINALISE_TOKEN);
  missing("Independent audit checkpoint token", env.WINDMILL_SIGNING_TOKEN);
  missing("Email webhook secret", env.RESEND_SIGNING_WEBHOOK_SECRET);
  return blockers;
}

// A pilot domain entry for a public mailbox provider would make the pilot effectively live.
const PUBLIC_MAIL_DOMAINS = new Set([
  "@gmail.com",
  "@googlemail.com",
  "@outlook.com",
  "@hotmail.com",
  "@live.com",
  "@yahoo.com",
  "@icloud.com",
  "@aol.com",
  "@proton.me",
  "@protonmail.com",
  "@gmx.com",
  "@mail.com",
]);
export function normalizePilotRecipient(value: string) {
  const entry = value.trim().toLowerCase();
  if (PUBLIC_MAIL_DOMAINS.has(entry))
    throw new ConvexError(
      "Public mailbox domains cannot be allowlisted; list exact pilot addresses instead",
    );
  if (
    entry.length > 254 ||
    !(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry) ||
      /^@[^\s@]+\.[^\s@]+$/.test(entry)
    )
  )
    throw new ConvexError(
      "Pilot recipients must be exact email addresses or @domain entries",
    );
  return entry;
}
export function pilotAllows(record: Doc<"signingReleases">, email: string) {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@"));
  return record.pilotRecipients.some(
    (entry) => entry === address || entry === domain,
  );
}

export async function releaseRecord(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
) {
  return ctx.db
    .query("signingReleases")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .unique();
}

/**
 * Every reason external messages may not be sent. Empty means release is permitted:
 * deployment key + unsuspended company record + complete policy + configured services,
 * and in pilot mode every recipient must be explicitly allowlisted.
 */
export async function releaseBlockers(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  options: { category?: SigningCategory; recipients?: string[] } = {},
) {
  const blockers: string[] = [];
  const deployment = deploymentReleaseMode();
  if (deployment === "off")
    blockers.push("Signing release is switched off for this deployment");
  const record = await releaseRecord(ctx, tenantId);
  const tenant = await ctx.db.get(tenantId);
  if (!tenant || tenant.status !== "active")
    blockers.push("The company is not active");
  if (!record)
    blockers.push("No release record has been approved for this company");
  else if (record.suspendedAt)
    blockers.push("Signing release is suspended for this company");
  else {
    if (
      !record.legalSignOffReference.trim() ||
      !record.acceptanceReference.trim()
    )
      blockers.push(
        "Legal sign-off and acceptance evidence references are required",
      );
    if (deployment === "pilot" && record.mode === "live")
      blockers.push("This deployment only permits pilot releases");
    if (record.mode === "pilot" || deployment === "pilot") {
      const outside = (options.recipients ?? []).filter(
        (email) => !pilotAllows(record, email),
      );
      if (outside.length)
        blockers.push(
          `${outside.length} participant address${outside.length === 1 ? " is" : "es are"} outside the pilot allowlist`,
        );
    }
  }
  const policy = await ctx.db
    .query("signingPolicies")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .unique();
  blockers.push(
    ...policyBlockers(policy, options.category),
    ...serviceBlockers(),
  );
  return blockers;
}

export async function assertRelease(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  options: { category?: SigningCategory; recipients?: string[] } = {},
) {
  const blockers = await releaseBlockers(ctx, tenantId, options);
  if (blockers.length)
    throw new ConvexError(
      `External invitations remain blocked: ${blockers[0]}`,
    );
}
