import { env } from "./_generated/server";
import {
  invitationCredential,
  keyring,
  keyedHash,
  sealEmail,
} from "./lib/signingAccessCrypto";
import type { EmailKind, MailDraft } from "./lib/signingInvitations";
export function accessKeys() {
  return keyring(
    env.SIGNING_ACCESS_KEYS_JSON,
    env.SIGNING_ACCESS_ACTIVE_KEY_ID,
  );
}
export function signingOrigin() {
  const url = new URL(
    env.SIGNING_PORTAL_ORIGIN ?? "https://unconfigured.invalid",
  );
  if (
    !env.SIGNING_PORTAL_ORIGIN ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Signing portal origin is not configured");
  return url.origin;
}
export function signingSender() {
  const from = env.SIGNING_SENDER_ADDRESS ?? "";
  if (
    !/^[^\r\n<>]{0,100}<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(from) &&
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
  )
    throw new Error("Signing sender is not configured");
  return from;
}
export async function makeEmail(input: {
  kind: EmailKind;
  participantKey: string;
  version: number;
  recipient: string;
  companyName: string;
  title: string;
  expiresAt: number;
  credential?: string;
  code?: string;
  deliveryKey?: string;
}): Promise<MailDraft> {
  const ring = accessKeys(),
    keyId = ring.active,
    deliveryKey = input.deliveryKey ?? crypto.randomUUID(),
    expectedFrom = signingSender();
  const payloadExpiresAt = Math.min(
    input.expiresAt,
    Date.now() + (input.kind === "otp" ? 10 * 60_000 : 60 * 60_000),
  );
  const payload = {
    contractVersion: 1,
    deliveryId: deliveryKey,
    kind: input.kind,
    recipient: input.recipient,
    from: expectedFrom,
    companyName: input.companyName,
    title: input.title,
    expiresAt: payloadExpiresAt,
    origin: signingOrigin(),
    ...(input.credential
      ? { link: `${signingOrigin()}/sign#${input.credential}` }
      : {}),
    ...(input.code ? { code: input.code } : {}),
  };
  return {
    deliveryKey,
    participantKey: input.participantKey,
    kind: input.kind,
    keyId,
    expectedFrom,
    payloadExpiresAt,
    invitationVersion: input.version,
    recipientHash: await keyedHash(
      ring.keys[keyId],
      "recipient-v1",
      input.recipient.toLowerCase(),
    ),
    sealed: await sealEmail(
      ring.keys[keyId],
      keyId,
      deliveryKey,
      input.kind,
      payload,
    ),
  };
}
export async function regenerateInvitation(input: {
  keyId: string;
  reference: string;
  preparationHash: string;
  participantKey: string;
  version: number;
  nonce: string;
}) {
  const ring = accessKeys();
  return invitationCredential(
    ring.keys[input.keyId],
    input.reference,
    input.preparationHash,
    input.participantKey,
    input.version,
    input.nonce,
  );
}
