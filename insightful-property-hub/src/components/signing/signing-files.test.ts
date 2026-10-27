import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Doc } from "../../../../convex/_generated/dataModel";
const state = vi.hoisted(() => ({
  configured: true,
  ready: false,
  busy: false,
  authenticated: true,
}));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "staff-user" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: () => ({
    configured: state.configured,
    busy: state.busy,
    fileRevision: 1,
    files: [
      {
        id: "file-primary",
        filename: "Lease <script>unsafe</script>.pdf",
        role: "primary",
        sizeBytes: 200,
      },
    ],
    attempt: state.busy
      ? { id: "attempt", status: "submission_unknown", waitingTimedOut: true }
      : null,
    bundle: state.ready
      ? { id: "bundle", pageCount: 2, pdfHash: "a".repeat(64), manifestHash: "b".repeat(64) }
      : null,
  }),
}));
import { SigningFiles } from "./signing-files";
const agreement = { _id: "agreement", status: "draft", revision: 1 } as Doc<"signingAgreements">;
beforeEach(() => {
  state.configured = true;
  state.ready = false;
  state.busy = false;
  state.authenticated = true;
});
test("quarantined files have no preview, raw URL or signing control", () => {
  const html = renderToStaticMarkup(createElement(SigningFiles, { agreement, canEdit: true }));
  expect(html).toContain("Quarantined — no participant access");
  expect(html).not.toContain("View prepared PDF");
  expect(html).not.toMatch(/href="https?:/);
  expect(html).not.toContain("<script>unsafe</script>");
  expect(html).toContain("&lt;script&gt;");
});
test("staff can view a validated bundle without privileged editing controls", () => {
  state.ready = true;
  const html = renderToStaticMarkup(createElement(SigningFiles, { agreement, canEdit: false }));
  expect(html).toContain("View prepared PDF");
  expect(html).toContain("PDF SHA-256");
  expect(html).not.toContain("Upload to quarantine");
  expect(html).not.toContain("Prepare and validate PDF bundle</button>");
  expect(html).not.toContain("Finish and sign");
});
test("an unresolved job offers reconciliation without new preparation or upload", () => {
  state.busy = true;
  const html = renderToStaticMarkup(createElement(SigningFiles, { agreement, canEdit: true }));
  expect(html).toContain("Reconcile existing job");
  expect(html).toContain("submission unknown");
  expect(html).not.toContain("Prepare and validate PDF bundle</button>");
});
test("a signed-out identity renders no private filenames", () => {
  state.authenticated = false;
  expect(renderToStaticMarkup(createElement(SigningFiles, { agreement, canEdit: true }))).toBe("");
});
