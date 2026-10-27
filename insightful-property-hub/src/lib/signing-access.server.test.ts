// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { signingAccessApi, signingAccessPage } from "./signing-access.server";
const origin = "https://portal.example.test",
  secret = "synthetic-server-service-token-123456789",
  raw = "A".repeat(43),
  challenge = "B".repeat(43),
  session = "C".repeat(43);
const challengeCookie = `__Secure-cyphersoft-signing-challenge=${challenge}`;
const sessionCookie = `__Secure-cyphersoft-signing-session=${session}`;
function request(
  operation: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/signing`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ operation, ...body }),
  });
}
function upstream(value: Record<string, unknown>) {
  const fetch = vi.fn().mockResolvedValue(Response.json(value));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  vi.stubEnv("SIGNING_PORTAL_ORIGIN", origin);
  vi.stubEnv("SIGNING_CONVEX_SITE_URL", "https://convex.example.test");
  vi.stubEnv("SIGNING_PORTAL_SERVICE_TOKEN", secret);
  vi.stubEnv("SIGNING_TRUSTED_PROXY_HOPS", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("first-party signing access boundary", () => {
  test("standalone page is private, framed out, and has only one local script", async () => {
    const fetch = upstream({}),
      response = signingAccessPage(),
      html = await response.text();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    const nonce = html.match(/<style nonce="([^"]+)"/)![1];
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(html).toContain('src="/signing-access.js"');
    expect(html).not.toMatch(/https?:\/\/|Google|Copilot|error-reporter|localStorage/);
    expect(html).toContain("You have not signed anything");
    expect(fetch).not.toHaveBeenCalled();
  });
  test("anonymous GET never exchanges links or sends messages", async () => {
    const fetch = upstream({ ok: true });
    const response = await signingAccessApi(new Request(`${origin}/api/signing?invitation=${raw}`));
    expect(await response.json()).toEqual({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each(["session", "challenge"])("GET reads %s without state changes", async (kind) => {
    const fetch = upstream({
      ok: true,
      companyName: "Company",
      challengeCredential: challenge,
      sessionCredential: session,
      unexpected: "hidden",
    });
    const response = await signingAccessApi(
      new Request(`${origin}/api/signing`, {
        headers: { Cookie: kind === "session" ? sessionCookie : challengeCookie },
      }),
    );
    expect(await response.json()).toEqual({ ok: true, companyName: "Company" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).operation).toBe(kind);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  test.each<Record<string, string>>([
    { Origin: "https://attacker.example.test" },
    { "Content-Type": "text/plain" },
    { "Sec-Fetch-Site": "cross-site" },
  ])("rejects cross-origin requests before backend access: %s", async (headers) => {
    const fetch = upstream({ ok: true });
    expect(
      (await signingAccessApi(request("exchange", { invitationToken: raw }, headers))).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  test("exchanges fragment credential through body only, setting narrowly scoped secure cookies", async () => {
    const fetch = upstream({
      ok: true,
      challengeCredential: challenge,
      expiresAt: Date.now() + 900_000,
      recipient: "a***@e***.test",
    });
    const response = await signingAccessApi(request("exchange", { invitationToken: raw })),
      body = await response.text();
    expect(body).not.toContain(challenge);
    expect(body).not.toContain(raw);
    expect(body).not.toContain(secret);
    const cookies = response.headers.get("set-cookie")!;
    expect(cookies).toContain(challengeCookie);
    expect(cookies).toContain("Path=/api/signing; HttpOnly; Secure; SameSite=Strict");
    expect(cookies).not.toContain("Domain=");
    expect(fetch.mock.calls[0][0]).toBe("https://convex.example.test/signing/access");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${secret}`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      operation: "exchange",
      credential: raw,
      network: "unattributed",
    });
  });
  test("OTP uses HttpOnly challenge, ignoring client-selected credentials; session never enters response body", async () => {
    const fetch = upstream({
      ok: true,
      sessionCredential: session,
      expiresAt: Date.now() + 1_800_000,
    });
    const response = await signingAccessApi(
      request("verify_code", { code: "12345678", credential: raw }, { Cookie: challengeCookie }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      credential: challenge,
      code: "12345678",
    });
    expect(await response.text()).not.toContain(session);
    expect(response.headers.get("set-cookie")).toContain(sessionCookie);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  test("trusted proxy count selects from right; unset configuration refuses to operate", async () => {
    const fetch = upstream({ ok: false }),
      headers = {
        Cookie: challengeCookie,
        "X-Forwarded-For": "192.0.2.66, 198.51.100.7, 203.0.113.8",
      };
    vi.stubEnv("SIGNING_TRUSTED_PROXY_HOPS", "");
    expect((await signingAccessApi(request("request_code", {}, headers))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("SIGNING_TRUSTED_PROXY_HOPS", "2");
    await signingAccessApi(request("request_code", {}, headers));
    expect(JSON.parse(fetch.mock.calls[0][1].body).network).toBe("198.51.100.7");
  });
  test("oversized request and upstream errors expose no sensitive provider content", async () => {
    const fetch = upstream({});
    expect((await signingAccessApi(request("exchange", { extra: "x".repeat(5000) }))).status).toBe(
      503,
    );
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValue(new Error(`private-provider-content ${secret}`));
    const response = await signingAccessApi(
      request("request_code", {}, { Cookie: challengeCookie }),
    );
    expect(await response.text()).not.toContain(secret);
  });
  test("signer operations use only the HttpOnly session cookie and pass conflicts through", async () => {
    const fetch = upstream({});
    fetch.mockImplementation(async () =>
      Response.json(
        { ok: false, error: "Changed", conflict: { revision: 2, values: {} } },
        { status: 409 },
      ),
    );
    const response = await signingAccessApi(
      request(
        "save_draft",
        { expectedRevision: 1, values: { a: "b" }, credential: raw, operation: "save_draft" },
        { Cookie: `${challengeCookie}; ${sessionCookie}` },
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Changed",
      conflict: { revision: 2, values: {} },
    });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      operation: "save_draft",
      credential: session,
      expectedRevision: 1,
      values: { a: "b" },
    });
    expect((await signingAccessApi(request("submit", { requestKey: "k" }))).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test("per-operation body limits allow signature images but keep other requests small", async () => {
    const fetch = upstream({ ok: true, mark: { hash: "h" } });
    const image = "x".repeat(100_000);
    expect(
      (await signingAccessApi(request("adopt_mark", { image }, { Cookie: sessionCookie }))).status,
    ).toBe(200);
    expect(
      (
        await signingAccessApi(
          request("consent", { consentHash: image }, { Cookie: sessionCookie }),
        )
      ).status,
    ).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test("supporting documents are forwarded server-side; storage URLs never reach the browser", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          attachmentId: "att1",
          url: "https://storage.example.test/quarantine",
          fields: { key: "attachments-quarantine/t/a/att1", "Content-Type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, sha256: "d".repeat(64), filename: "id.png" }),
      );
    vi.stubGlobal("fetch", fetch);
    const upload = (headers: Record<string, string>, body: BodyInit = new Uint8Array([137, 80])) =>
      signingAccessApi(
        new Request(`${origin}/api/signing?upload=attachment`, {
          method: "POST",
          headers: { Origin: origin, Cookie: sessionCookie, ...headers },
          body,
        }),
      );
    const ok = await upload({
      "Content-Type": "image/png",
      "X-Signing-Field": "t-proof",
      "X-Signing-Filename": encodeURIComponent("id.png"),
    });
    expect(await ok.json()).toEqual({ ok: true, sha256: "d".repeat(64), filename: "id.png" });
    const form = JSON.parse(fetch.mock.calls[0][1].body);
    expect(form).toMatchObject({
      operation: "attachment_form",
      credential: session,
      fieldKey: "t-proof",
      contentType: "image/png",
      sizeBytes: 2,
    });
    expect(fetch.mock.calls[1][0].toString()).toBe("https://storage.example.test/quarantine");
    const sent = fetch.mock.calls[1][1].body as FormData;
    expect(sent.get("key")).toBe("attachments-quarantine/t/a/att1");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({
      operation: "attachment_complete",
      attachmentId: "att1",
    });
    expect((await upload({ "Content-Type": "text/html" })).status).toBe(403);
    expect(
      (await upload({ "Content-Type": "image/png" }, new Uint8Array(10 * 1024 * 1024 + 1))).status,
    ).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  test("portal view is read-only and responses never expose storage URLs", async () => {
    const fetch = upstream({
      ok: true,
      portal: { mode: "active" },
      url: "https://storage.example.test/x",
    });
    const response = await signingAccessApi(
      new Request(`${origin}/api/signing?view=portal`, { headers: { Cookie: sessionCookie } }),
    );
    expect(await response.json()).toEqual({ ok: true, portal: { mode: "active" } });
    expect(JSON.parse(fetch.mock.calls[0][1].body).operation).toBe("portal");
  });
  test("document bytes are verified server-side against the frozen hash before streaming", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 synthetic");
    const hash = createHash("sha256").update(pdf).digest("hex");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: true, url: "https://storage.example.test/x?sig=1", pdfHash: hash }),
      )
      .mockResolvedValueOnce(new Response(pdf));
    vi.stubGlobal("fetch", fetch);
    const get = (view: string, cookies = sessionCookie) =>
      signingAccessApi(
        new Request(`${origin}/api/signing?view=${view}`, { headers: { Cookie: cookies } }),
      );
    const ok = await get("download");
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("content-disposition")).toContain("attachment");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(pdf);
    expect(fetch.mock.calls[1][0].toString()).toBe("https://storage.example.test/x?sig=1");
    fetch
      .mockResolvedValueOnce(
        Response.json({ ok: true, url: "https://storage.example.test/x", pdfHash: hash }),
      )
      .mockResolvedValueOnce(new Response("tampered"));
    expect((await get("document")).status).toBe(503);
    fetch.mockResolvedValueOnce(
      Response.json({ ok: true, url: "http://storage.example.test/x", pdfHash: hash }),
    );
    expect((await get("document")).status).toBe(503);
    expect((await get("document", challengeCookie)).status).toBe(401);
    fetch
      .mockResolvedValueOnce(
        Response.json({ ok: true, url: "https://storage.example.test/s", pdfHash: hash }),
      )
      .mockResolvedValueOnce(new Response(pdf));
    const sealed = await get("final");
    expect(sealed.headers.get("content-disposition")).toContain("signed-agreement.pdf");
    expect(JSON.parse(fetch.mock.calls.at(-2)![1].body).operation).toBe("final_document");
  });
  test("standalone portal module avoids storage, logging and external origins", () => {
    const script = readFileSync(new URL("../../public/signing-portal.js", import.meta.url), "utf8");
    expect(script).not.toMatch(
      /localStorage|sessionStorage|indexedDB|console\.|https?:\/\/|innerHTML/,
    );
    expect(script).not.toContain("sessionCredential");
    expect(script).toContain("requestKey");
  });
  test("public bootstrap removes fragments before any request and keeps credentials out of browser storage", () => {
    const script = readFileSync(new URL("../../public/signing-access.js", import.meta.url), "utf8");
    expect(script.indexOf("history.replaceState")).toBeLessThan(script.indexOf("fetch("));
    expect(script).not.toMatch(/localStorage|sessionStorage|console\.|https?:\/\//);
    expect(script).not.toContain("sessionCredential");
    expect(script).not.toContain("challengeCredential");
  });
});
