import { createFileRoute } from "@tanstack/react-router";

type ScannerAction = "detect-edges" | "process-image" | "generate-pdf" | "save-document";

const actionEnvMap: Record<ScannerAction, string | undefined> = {
  "detect-edges": process.env.WINDMILL_SCANNER_DETECT_URL,
  "process-image": process.env.WINDMILL_SCANNER_PROCESS_URL,
  "generate-pdf": process.env.WINDMILL_SCANNER_GENERATE_PDF_URL,
  "save-document": process.env.WINDMILL_SCANNER_SAVE_URL,
};

export const Route = createFileRoute("/api/scanner/$action")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const action = params.action as ScannerAction;
        const targetUrl = actionEnvMap[action];

        if (!targetUrl) {
          return Response.json(
            {
              success: false,
              error: `The scanner backend for "${action}" is not configured. Set the WINDMILL_SCANNER_* environment variables first.`,
            },
            { status: 503 },
          );
        }

        const body = await request.text();
        const headers = new Headers({
          "Content-Type": request.headers.get("content-type") ?? "application/json",
        });
        const bearerToken = process.env.WINDMILL_SCANNER_BEARER_TOKEN?.trim();
        if (bearerToken) {
          headers.set("Authorization", `Bearer ${bearerToken}`);
        }

        const upstream = await fetch(targetUrl, {
          method: "POST",
          headers,
          body,
          signal: request.signal,
        });

        const responseText = await upstream.text();
        const upstreamContentType = upstream.headers.get("content-type") ?? "application/json";
        return new Response(responseText, {
          status: upstream.status,
          headers: {
            "Content-Type": upstreamContentType,
          },
        });
      },
    },
  },
});
