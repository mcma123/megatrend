import { createFileRoute } from "@tanstack/react-router";
import { signingAccessPage } from "@/lib/signing-access.server";
// A standalone response deliberately bypasses the application shell and its external assets.
export const Route = createFileRoute("/sign")({
  server: { handlers: { GET: () => signingAccessPage() } },
});
