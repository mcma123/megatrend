/** Web Crypto primitives; callers supply server-only versioned keys, never browser keys. */
const encoder = new TextEncoder();
export const HKDF_SALT = "Cyphersoft signing keys v1";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function unbase64url(value: string) {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
export function secretToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export function otpCode() {
  const ceiling = Math.floor(2 ** 32 / 100_000_000) * 100_000_000;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= ceiling);
  return String(value % 100_000_000).padStart(8, "0");
}
export async function sha256Text(value: string) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
export async function credentialHash(purpose: string, value: string) {
  return sha256Text(`${purpose}:${value}`);
}
function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function keyring(json: string | undefined, active: string | undefined) {
  const keys: unknown = JSON.parse(json ?? "{}");
  if (
    !active ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(active) ||
    !keys ||
    typeof keys !== "object" ||
    Array.isArray(keys)
  )
    throw new Error("Signing access keys are not configured");
  const values = keys as Record<string, string>;
  if (!/^[a-f0-9]{64}$/i.test(values[active] ?? ""))
    throw new Error("Signing access keys are not configured");
  return { active, keys: values };
}
async function derived(masterHex: string, purpose: string, cipher: boolean) {
  if (!/^[a-f0-9]{64}$/i.test(masterHex ?? ""))
    throw new Error("Signing access key unavailable");
  const bytes = Uint8Array.from(masterHex.match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  const master = await crypto.subtle.importKey("raw", bytes, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(purpose),
    },
    master,
    cipher
      ? { name: "AES-GCM", length: 256 }
      : { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    cipher ? ["encrypt", "decrypt"] : ["sign", "verify"],
  );
}
export async function keyedHash(
  master: string,
  purpose: string,
  value: string,
) {
  const key = await derived(master, purpose, false);
  return hex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
}
export async function invitationCredential(
  master: string,
  reference: string,
  preparationHash: string,
  participantKey: string,
  version: number,
  nonce: string,
) {
  const key = await derived(master, "invitation-v1", false);
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(
          JSON.stringify([
            reference,
            preparationHash,
            participantKey,
            version,
            nonce,
          ]),
        ),
      ),
    ),
  );
}
export async function sessionCredential(
  master: string,
  challengeId: string,
  generation: number,
  challengeHash: string,
) {
  const key = await derived(master, "session-v1", false);
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(
          JSON.stringify([challengeId, generation, challengeHash]),
        ),
      ),
    ),
  );
}
export async function sealEmail(
  master: string,
  keyId: string,
  deliveryId: string,
  kind: string,
  payload: unknown,
) {
  const key = await derived(master, "email-envelope-v1", true),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const body = encoder.encode(JSON.stringify(payload));
  if (body.length > 16_000) throw new Error("Email envelope exceeds limit");
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`signing-email/v1/${deliveryId}/${kind}`),
    },
    key,
    body,
  );
  return `v1.${keyId}.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
export async function openEmail(
  master: string,
  deliveryId: string,
  kind: string,
  sealed: string,
) {
  const [version, , nonce, body] = sealed.split(".");
  if (version !== "v1") throw new Error("Invalid envelope");
  const key = await derived(master, "email-envelope-v1", true);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64url(nonce),
      additionalData: encoder.encode(`signing-email/v1/${deliveryId}/${kind}`),
    },
    key,
    unbase64url(body),
  );
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(plain),
  ) as unknown;
}
export function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
