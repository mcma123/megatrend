"use node";
import { Webhook } from "svix";
import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessKeys } from "./signingEmailPayloads";
import { keyedHash, sha256Text } from "./lib/signingAccessCrypto";

export function verifyResendEvent(
  raw: string,
  headers: Record<string, string>,
  secret: string,
) {
  new Webhook(secret).verify(raw, headers);
  return JSON.parse(raw) as {
    type?: unknown;
    created_at?: unknown;
    data?: unknown;
  };
}
export const ingest = internalAction({
  args: {
    raw: v.string(),
    id: v.string(),
    timestamp: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; status: number }> => {
    if (!env.RESEND_SIGNING_WEBHOOK_SECRET) return { ok: false, status: 503 };
    let event: ReturnType<typeof verifyResendEvent>;
    try {
      event = verifyResendEvent(
        args.raw,
        {
          "svix-id": args.id,
          "svix-timestamp": args.timestamp,
          "svix-signature": args.signature,
        },
        env.RESEND_SIGNING_WEBHOOK_SECRET,
      );
    } catch {
      return { ok: false, status: 401 };
    }
    if (
      typeof event.type !== "string" ||
      typeof event.created_at !== "string" ||
      !event.data ||
      typeof event.data !== "object"
    )
      return { ok: false, status: 400 };
    const data = event.data as Record<string, unknown>,
      tags = data.tags as Record<string, unknown> | undefined;
    const known = [
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.bounced",
      "email.complained",
      "email.failed",
      "email.suppressed",
    ];
    // Opens/clicks never imply authenticated portal use. Ignore unsupported signed events.
    if (!known.includes(event.type)) return { ok: true, status: 200 };
    const key =
      typeof tags?.signing_delivery === "string" ? tags.signing_delivery : "";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (
      typeof data.email_id !== "string" ||
      !uuid.test(data.email_id) ||
      typeof data.from !== "string" ||
      !Array.isArray(data.to) ||
      data.to.length !== 1 ||
      typeof data.to[0] !== "string" ||
      !uuid.test(key) ||
      !Number.isFinite(Date.parse(event.created_at))
    )
      return { ok: false, status: 400 };
    const delivery: { keyId: string } | null = await ctx.runQuery(
      internal.signingDeliveryEvents.findKey,
      { deliveryKey: key, providerMessageId: data.email_id },
    );
    if (!delivery) return { ok: true, status: 200 };
    try {
      const ring = accessKeys(),
        recipientHash = await keyedHash(
          ring.keys[delivery.keyId],
          "recipient-v1",
          data.to[0].toLowerCase(),
        );
      const status: number = await ctx.runMutation(
        internal.signingDeliveryEvents.record,
        {
          eventId: args.id,
          bodyHash: await sha256Text(args.raw),
          providerMessageId: data.email_id,
          deliveryKey: key,
          eventType: event.type,
          occurredAt: Date.parse(event.created_at),
          from: data.from,
          recipientHash,
        },
      );
      return { ok: status === 200, status };
    } catch {
      return { ok: false, status: 503 };
    }
  },
});
