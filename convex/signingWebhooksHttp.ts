import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { boundedBody } from "./signingAccess";
export const handle = httpAction(async (ctx, request) => {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const id = request.headers.get("svix-id") ?? "",
      timestamp = request.headers.get("svix-timestamp") ?? "",
      signature = request.headers.get("svix-signature") ?? "";
    if (
      !id ||
      id.length > 200 ||
      !timestamp ||
      timestamp.length > 30 ||
      !signature ||
      signature.length > 2000
    )
      return new Response("Invalid webhook", { status: 401, headers });
    const raw = await boundedBody(request, 65536);
    const result: { ok: boolean; status: number } = await ctx.runAction(
      internal.signingWebhooks.ingest,
      { raw, id, timestamp, signature },
    );
    return new Response(result.ok ? "OK" : "Webhook could not be accepted", {
      status: result.status,
      headers,
    });
  } catch {
    return new Response("Webhook unavailable", { status: 503, headers });
  }
});
