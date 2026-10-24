type StaffUser = { _id: string; isStaff: boolean } | null;

/** Dependencies are injected so auth, header isolation and streaming can be tested offline. */
export async function proxyCopilotRequest(
  request: Request,
  dependencies: {
    getUser: (request: Request) => Promise<StaffUser>;
    secret?: string;
    baseUrl: string;
    fetcher?: typeof fetch;
  },
) {
  const user = await dependencies.getUser(request);
  if (!user?.isStaff)
    return new Response("Sign in with a Cyphersoft staff account to use the assistant.", {
      status: 401,
    });
  if (!dependencies.secret)
    return new Response(
      "The assistant connection is not configured. Set MASTRA_COPILOTKIT_SERVICE_TOKEN on the portal and Mastra servers.",
      { status: 503 },
    );
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 2 * 1024 * 1024)
    return new Response("This conversation is too large. Start a new conversation.", {
      status: 413,
    });
  try {
    JSON.parse(body);
  } catch {
    return new Response("Invalid assistant request.", { status: 400 });
  }
  try {
    const upstream = await (dependencies.fetcher ?? fetch)(
      `${dependencies.baseUrl.replace(/\/$/, "")}/copilotkit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${dependencies.secret}`,
          "X-Cyphersoft-User-Id": user._id,
          "X-Cyphersoft-Model": request.headers.get("x-cyphersoft-model") ?? "",
          "X-Cyphersoft-Images":
            request.headers.get("x-cyphersoft-images") === "true" ? "true" : "false",
        },
        body,
        signal: request.signal,
      },
    );
    if (!upstream.ok)
      return new Response(
        "The assistant could not complete this request. Check its configuration or try again.",
        { status: upstream.status === 400 ? 400 : 502 },
      );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
        "Cache-Control": "no-cache, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response(
      request.signal.aborted
        ? "Request cancelled."
        : "The assistant service is unavailable. Try again shortly.",
      { status: request.signal.aborted ? 499 : 503 },
    );
  }
}
