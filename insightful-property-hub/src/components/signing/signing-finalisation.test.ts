import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  authenticated: true,
  completed: false,
  configured: true,
}));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "admin" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: () => ({
    agreementStatus: state.completed ? "completed" : "finalising",
    configured: state.configured,
    canRetry: !state.completed,
    canReconcile: false,
    attempts: [
      {
        id: "attempt",
        attempt: 1,
        status: state.completed ? "completed" : "failed",
        error: state.completed ? undefined : "timestamp_unavailable",
        message: state.completed ? null : "The trusted timestamp service did not respond",
        createdAt: 1800000000000,
        checks: 2,
        evidenceHash: "e".repeat(64),
        automatic: true,
      },
    ],
    completion: state.completed
      ? {
          id: "completion",
          pdfHash: "b".repeat(64),
          evidenceHash: "e".repeat(64),
          recordHash: "a".repeat(64),
          sizeBytes: 1000,
          pageCount: 3,
          certificatePageCount: 1,
          sealedAt: 1800000001000,
          completedAt: 1800000002000,
          retainUntil: 2100000000000,
          validation: { level: "PAdES-B-LT", signerSubject: "<Seal>", tsaSubject: "TSA" },
        }
      : null,
  }),
}));
import { SigningFinalisation } from "./signing-finalisation";
type Props = Parameters<typeof SigningFinalisation>[0];
const render = (canEdit = true) =>
  renderToStaticMarkup(
    createElement(SigningFinalisation, {
      agreementId: "agreement" as Props["agreementId"],
      canEdit,
    }),
  );
beforeEach(() => {
  state.authenticated = true;
  state.completed = false;
  state.configured = true;
});
test("failed attempts explain the fault and stay Finalising with a retry for MFA administrators", () => {
  const html = render();
  expect(html).toContain("The trusted timestamp service did not respond");
  expect(html).toContain("Retry finalisation");
  expect(html).not.toContain("Download sealed PDF");
  expect(html).toContain("not a participant");
  expect(render(false)).not.toContain("Retry finalisation");
});
test("missing configuration disables retry and never implies completion", () => {
  state.configured = false;
  const html = render();
  expect(html).toContain("not configured");
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Retry finalisation<\/button>/);
});
test("completed agreements show sealed hashes, escaped certificate subject and verification", () => {
  state.completed = true;
  const html = render(false);
  expect(html).toContain("PAdES-B-LT");
  expect(html).toContain("b".repeat(64));
  expect(html).toContain("&lt;Seal&gt;");
  expect(html).toContain("Download sealed PDF");
  expect(html).toContain("Verify integrity");
  expect(html).not.toContain("Retry finalisation");
});
test("sign-out clears the private evidence card", () => {
  state.authenticated = false;
  expect(render()).toBe("");
});
