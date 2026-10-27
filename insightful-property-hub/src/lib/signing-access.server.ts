import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
const CHALLENGE = "__Secure-cyphersoft-signing-challenge",
  SESSION = "__Secure-cyphersoft-signing-session";
const token = /^[A-Za-z0-9_-]{43}$/;
const PDF_LIMIT = 50 * 1024 * 1024,
  SEALED_LIMIT = 60 * 1024 * 1024,
  ATTACHMENT_LIMIT = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
// Signer-session operations read the HttpOnly session cookie; nothing here accepts a browser credential.
const SESSION_OPERATIONS = new Set([
  "consent",
  "save_draft",
  "adopt_mark",
  "submit",
  "decline",
  "request_correction",
]);
const BODY_LIMITS: Record<string, number> = { adopt_mark: 160_000, save_draft: 130_000 };
export const signingSecurityHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
function cookie(request: Request, name: string) {
  const value =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? "";
  return token.test(value) ? value : "";
}
function setCookie(headers: Headers, name: string, value: string, expiresAt: number) {
  if (value && !token.test(value)) throw new Error("Invalid access credential");
  headers.append(
    "Set-Cookie",
    `${name}=${value}; Path=/api/signing; HttpOnly; Secure; SameSite=Strict; Max-Age=${value ? Math.min(1800, Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))) : 0}`,
  );
}
function network(request: Request) {
  const hops = Number(process.env.SIGNING_TRUSTED_PROXY_HOPS ?? 0),
    chain =
      request.headers
        .get("x-forwarded-for")
        ?.split(",")
        .map((x) => x.trim()) ?? [];
  // Without a verified hop count every signer would share one platform-wide rate bucket, letting
  // one anonymous client exhaust it; refuse to operate instead (see signing-prerequisites.md).
  if (!Number.isInteger(hops) || hops < 1 || hops > 4)
    throw new Error("Trusted proxy hops are not configured");
  if (chain.length < hops) return "unattributed";
  const candidate = chain[chain.length - hops];
  return isIP(candidate) ? candidate : "unattributed";
}
async function limitedBytes(request: Pick<Request, "body">, max: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Request exceeds limit");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const part of parts) {
    bytes.set(part, pos);
    pos += part.length;
  }
  return bytes;
}
async function limitedJson(request: Pick<Request, "body">, max = 4096) {
  const bytes = await limitedBytes(request, max);
  if (!bytes.length) return { value: {} as Record<string, unknown>, size: 0 };
  return {
    value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<
      string,
      unknown
    >,
    size: bytes.length,
  };
}
async function backend(
  request: Request,
  operation: string,
  credential: string,
  extra: Record<string, unknown> = {},
) {
  const base = new URL(process.env.SIGNING_CONVEX_SITE_URL ?? "https://unconfigured.invalid"),
    secret = process.env.SIGNING_PORTAL_SERVICE_TOKEN;
  if (
    !process.env.SIGNING_CONVEX_SITE_URL ||
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !secret ||
    secret.length < 32
  )
    throw new Error("Signing service unconfigured");
  const response = await fetch(`${base.origin}/signing/access`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...extra, operation, credential, network: network(request) }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  return { response, value: (await limitedJson(response, 1_500_000)).value };
}
/**
 * Fetches the frozen (or sealed completed) PDF server-side so private storage URLs never reach
 * the signer's browser, and streams it only when its SHA-256 matches the recorded hash.
 */
async function verifiedDocument(
  request: Request,
  session: string,
  view: "document" | "download" | "final",
) {
  const { value } = await backend(
    request,
    view === "final" ? "final_document" : "document",
    session,
  );
  if (value.ok !== true || typeof value.url !== "string" || typeof value.pdfHash !== "string")
    return null;
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) return null;
  const bytes = await limitedBytes(response, view === "final" ? SEALED_LIMIT : PDF_LIMIT);
  if (createHash("sha256").update(bytes).digest("hex") !== value.pdfHash) return null;
  return new Response(bytes, {
    headers: {
      ...signingSecurityHeaders,
      "Content-Type": "application/pdf",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
      "Content-Disposition":
        view === "final"
          ? 'attachment; filename="signed-agreement.pdf"'
          : `${view === "download" ? "attachment" : "inline"}; filename="agreement.pdf"`,
      "X-Agreement-SHA256": value.pdfHash,
    },
  });
}
function status(response: Response) {
  return response.ok ? 200 : [400, 409, 429].includes(response.status) ? response.status : 503;
}
/**
 * Supporting documents arrive as raw bytes on the portal origin and are forwarded server-side to
 * the short-lived quarantine form, so storage URLs never reach the browser (connect-src 'self').
 */
async function uploadAttachment(
  request: Request,
  reply: (body: unknown, status?: number) => Response,
) {
  const session = cookie(request, SESSION);
  if (!session)
    return reply(
      { ok: false, error: "Your secure session has ended. Reopen your invitation link" },
      401,
    );
  const contentType = request.headers.get("content-type") ?? "";
  let filename = "";
  try {
    filename = decodeURIComponent(request.headers.get("x-signing-filename") ?? "");
  } catch {
    filename = "";
  }
  const bytes = await limitedBytes(request, ATTACHMENT_LIMIT);
  if (!bytes.length) return reply({ ok: false, error: "The file is empty" }, 400);
  const form = await backend(request, "attachment_form", session, {
    fieldKey: (request.headers.get("x-signing-field") ?? "").slice(0, 64),
    filename: filename.slice(0, 255),
    contentType,
    sizeBytes: bytes.length,
  });
  const fields = form.value.fields;
  if (
    form.value.ok !== true ||
    typeof form.value.url !== "string" ||
    typeof form.value.attachmentId !== "string" ||
    !fields ||
    typeof fields !== "object"
  )
    return reply(publicResult(form.value), status(form.response));
  const target = new URL(form.value.url);
  if (target.protocol !== "https:" || target.username || target.password || target.hash)
    throw new Error("Invalid upload target");
  const body = new FormData();
  for (const [key, value] of Object.entries(fields as Record<string, unknown>))
    body.append(key, String(value));
  body.append("file", new Blob([bytes], { type: contentType }), "upload");
  const stored = await fetch(target, {
    method: "POST",
    body,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!stored.ok)
    return reply({ ok: false, error: "The upload did not complete. Please try again" }, 503);
  const done = await backend(request, "attachment_complete", session, {
    attachmentId: form.value.attachmentId,
  });
  return reply(publicResult(done.value), status(done.response));
}
export async function signingAccessApi(request: Request) {
  const headers = new Headers({
    ...signingSecurityHeaders,
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  try {
    if (request.method === "GET") {
      const session = cookie(request, SESSION),
        challenge = cookie(request, CHALLENGE),
        view = new URL(request.url).searchParams.get("view");
      if (!session && !challenge) return reply({ ok: false });
      if (view === "document" || view === "download" || view === "final") {
        if (!session) return reply({ ok: false }, 401);
        return (
          (await verifiedDocument(request, session, view)) ??
          reply({ ok: false, error: "The agreement document is unavailable" }, 503)
        );
      }
      const { value } = await backend(
        request,
        session ? (view === "portal" ? "portal" : "session") : "challenge",
        session || challenge,
      );
      return reply(publicResult(value));
    }
    if (request.method !== "POST") return reply({ ok: false, error: "Method unavailable" }, 405);
    const upload = new URL(request.url).searchParams.get("upload") === "attachment";
    const origin = process.env.SIGNING_PORTAL_ORIGIN;
    const configuredOrigin = origin ? new URL(origin) : null;
    if (
      !origin ||
      !configuredOrigin ||
      configuredOrigin.origin !== request.headers.get("origin") ||
      configuredOrigin.protocol !== "https:" ||
      configuredOrigin.pathname !== "/" ||
      configuredOrigin.username ||
      configuredOrigin.password ||
      configuredOrigin.search ||
      configuredOrigin.hash ||
      !(upload
        ? ATTACHMENT_TYPES.has(request.headers.get("content-type") ?? "")
        : request.headers.get("content-type")?.startsWith("application/json")) ||
      (request.headers.get("sec-fetch-site") &&
        request.headers.get("sec-fetch-site") !== "same-origin")
    )
      return reply({ ok: false, error: "Request origin rejected" }, 403);
    if (upload) return await uploadAttachment(request, reply);
    const { value: body, size } = await limitedJson(request, 160_000),
      operation = String(body.operation);
    if (size > (BODY_LIMITS[operation] ?? 4096)) throw new Error("Request exceeds limit");
    if (
      !["exchange", "kiosk_exchange", "request_code", "verify_code", "logout"].includes(
        operation,
      ) &&
      !SESSION_OPERATIONS.has(operation)
    )
      return reply({ ok: false, error: "Invalid operation" }, 400);
    const credential =
      operation === "exchange"
        ? typeof body.invitationToken === "string" && token.test(body.invitationToken)
          ? body.invitationToken
          : "invalid"
        : operation === "kiosk_exchange"
          ? typeof body.kioskToken === "string" && token.test(body.kioskToken)
            ? body.kioskToken
            : "invalid"
          : cookie(
              request,
              operation === "logout" || SESSION_OPERATIONS.has(operation) ? SESSION : CHALLENGE,
            );
    if (SESSION_OPERATIONS.has(operation) && !credential)
      return reply(
        { ok: false, error: "Your secure session has ended. Reopen your invitation link" },
        401,
      );
    const extra: Record<string, unknown> = {};
    if (operation === "verify_code")
      extra.code = typeof body.code === "string" && body.code.length <= 64 ? body.code : "invalid";
    if (SESSION_OPERATIONS.has(operation))
      for (const key of [
        "consentHash",
        "expectedRevision",
        "values",
        "kind",
        "method",
        "image",
        "typedText",
        "requestKey",
        "expectedDraftRevision",
        "preparationHash",
        "pdfHash",
        "reason",
      ])
        if (body[key] !== undefined) extra[key] = body[key];
    const { response, value } = await backend(request, operation, credential, extra);
    if (value.ok === true) {
      if (operation === "exchange" || operation === "kiosk_exchange") {
        setCookie(headers, CHALLENGE, String(value.challengeCredential), Number(value.expiresAt));
        setCookie(headers, SESSION, "", 0);
      } else if (operation === "verify_code") {
        setCookie(headers, SESSION, String(value.sessionCredential), Number(value.expiresAt));
        setCookie(headers, CHALLENGE, "", 0);
      } else if (operation === "logout") {
        setCookie(headers, SESSION, "", 0);
        setCookie(headers, CHALLENGE, "", 0);
      }
    }
    return reply(
      publicResult(value),
      response.ok ? 200 : [400, 409, 429].includes(response.status) ? response.status : 503,
    );
  } catch {
    return reply(
      {
        ok: false,
        error: "Secure signing is unavailable. Please retry or contact the company",
      },
      503,
    );
  }
}
const SCALARS = [
  "ok",
  "error",
  "expiresAt",
  "retryAt",
  "recipient",
  "challengeReady",
  "companyName",
  "title",
  "role",
  "responsibility",
  "reference",
  "authMethod",
  "acceptedAt",
  "duplicate",
  "sha256",
  "filename",
];
// Structured results are produced by the signer-portal backend for display; credentials and URLs are never among them.
const OBJECTS = ["portal", "draft", "conflict", "mark", "receipt", "problems"];
function publicResult(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of SCALARS)
    if (
      typeof value[key] === "string" ||
      typeof value[key] === "number" ||
      typeof value[key] === "boolean"
    )
      result[key] = value[key];
  for (const key of OBJECTS)
    if (value[key] && typeof value[key] === "object") result[key] = value[key];
  return result;
}
export function signingAccessPage() {
  const nonce = randomBytes(18).toString("base64");
  const headers = {
    ...signingSecurityHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  };
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Secure agreement signing · Cyphersoft</title><style nonce="${nonce}">${PORTAL_CSS}</style><script type="module" src="/signing-access.js"></script></head><body><header class="bar"><div><p class="brand" id="brand">Cyphersoft · Secure signing</p><p class="muted small" id="contact"></p></div><button id="logout" class="ghost" hidden>End session</button></header><main id="main"><section id="access" class="card narrow"><h1>Verify your invitation</h1><p class="muted">Verify the email address the company invited. No permanent platform account is needed.</p><section id="start"><p id="start-help" class="muted">Open the personal link in your invitation email to continue.</p><button id="begin" hidden>Verify access</button></section><section id="challenge" hidden><p id="recipient" class="muted"></p><button id="send-code">Send email code</button><form id="code-form" hidden><label for="code">Eight-digit email code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required><div class="row"><button id="verify" type="submit">Verify email</button></div></form><p class="muted small">Requesting or entering a code does not sign a document. You have not signed anything.</p></section></section><section id="portal" hidden></section><p id="message" role="status" aria-live="polite"></p><noscript><p>Enable JavaScript to use secure signing.</p></noscript></main><footer>Personal access links and codes should not be shared. Email verification confirms mailbox access only. For assistance, contact the company that sent your invitation.</footer></body></html>`,
    { headers },
  );
}
const PORTAL_CSS = `:root{font-family:system-ui,sans-serif;color:#172c28;background:#f4f7f6;--ink:#172c28;--muted:#64756d;--line:#dae4df;--brand:#255c48;--soft:#edf3ef;--warn:#8b3028;--own:#2f6fd0}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column}.bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:white;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}.brand{margin:0;font-size:12px;letter-spacing:.12em;color:#426a59;text-transform:uppercase}main{flex:1;width:100%;max-width:1100px;margin:0 auto;padding:16px}.card{background:white;border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:16px}.narrow{max-width:540px;margin:4vh auto 16px}h1{font-size:24px;margin:4px 0 10px}h2{font-size:18px;margin:0 0 8px}h3{font-size:15px;margin:12px 0 6px}.muted{color:var(--muted);font-size:14px;line-height:1.6}.small{font-size:12px;margin:0}button{border:0;border-radius:8px;background:var(--brand);color:white;padding:10px 16px;font-size:15px;font-weight:600;cursor:pointer;min-height:44px}button:disabled{opacity:.5;cursor:not-allowed}.secondary{background:var(--soft);color:var(--brand)}.ghost{background:transparent;color:var(--brand);border:1px solid var(--line)}.danger{background:#f7e8e6;color:var(--warn)}label{display:block;font-size:14px;margin:14px 0 6px}input[type=checkbox]{width:20px;height:20px;flex:none;margin:2px 0 0}label.row{flex-wrap:nowrap;align-items:flex-start;margin-top:14px}input,textarea{width:100%;padding:10px;font-size:16px;border:1px solid #a5b7ae;border-radius:8px;font-family:inherit}.code{font-size:24px;letter-spacing:.2em}#message{color:var(--warn);font-size:14px;min-height:22px;line-height:1.5}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center}[hidden]{display:none!important}:focus-visible{outline:3px solid #5c9c80;outline-offset:3px}footer{border-top:1px solid #e1e8e4;padding:14px 16px;font-size:12px;color:#74847c;text-align:center}.summary{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted)}.progress{height:8px;background:var(--soft);border-radius:4px;overflow:hidden;margin:10px 0}.progress>span{display:block;height:100%;background:var(--brand);width:0}.toolbar{position:sticky;top:61px;z-index:15;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#f4f7f6;padding:8px 0}.toolbar button{min-height:40px;padding:8px 12px;font-size:14px}.status{font-size:13px;color:var(--muted)}.pages{display:flex;flex-direction:column;align-items:center;gap:16px}.page{position:relative;background:white;box-shadow:0 2px 10px #203b2b22;max-width:100%}.page canvas{display:block}.field{position:absolute;border:2px dashed var(--own);background:#2f6fd014;color:var(--ink);font-size:12px;padding:0 4px;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;border-radius:3px;font-weight:500}.field.done{border-style:solid;background:#2f9d6214;border-color:#2f9d62}.field.locked{border:1px solid #a5b7ae;background:#f4f7f6cc;cursor:default;color:#33443d}.field.missing{border-color:#d0802f}.field img{max-width:100%;max-height:100%;object-fit:contain}.field.current{outline:3px solid #f0b429}.editor{position:sticky;bottom:0;z-index:15;background:white;border:1px solid var(--line);border-radius:14px 14px 0 0;padding:14px 16px;box-shadow:0 -6px 24px #203b2b18}dialog{border:1px solid var(--line);border-radius:14px;max-width:min(640px,calc(100vw - 32px));width:100%;padding:20px}dialog::backdrop{background:#0b1a1488}.tabs{display:flex;gap:6px;margin:8px 0}.tabs button{min-height:36px;padding:6px 12px;font-size:14px}.tabs button[aria-selected=true]{background:var(--brand);color:white}.tabs button[aria-selected=false]{background:var(--soft);color:var(--brand)}.pad{width:100%;height:180px;border:1px dashed #a5b7ae;border-radius:8px;touch-action:none;background:white;display:block}.preview{max-width:100%;max-height:120px;border:1px solid var(--line);border-radius:8px;background:white}.list{margin:8px 0;padding-left:18px;font-size:14px;line-height:1.7}.review dt{font-weight:600;font-size:13px}.review dd{margin:0 0 8px;font-size:14px}.review img{max-height:48px}.banner{border-left:4px solid #d0802f;background:#fff7ec;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:14px}.ok{border-left-color:#2f9d62;background:#eef8f2}@media(max-width:640px){.card{padding:16px}.toolbar{top:57px}}`;
