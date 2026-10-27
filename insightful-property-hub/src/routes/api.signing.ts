import { createFileRoute } from "@tanstack/react-router";
import { signingAccessApi } from "@/lib/signing-access.server";
export const Route = createFileRoute("/api/signing")({
  server: {
    handlers: {
      GET: ({ request }) => signingAccessApi(request),
      POST: ({ request }) => signingAccessApi(request),
    },
  },
});
