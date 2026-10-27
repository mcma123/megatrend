import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  authenticated: true,
  status: "draft",
  bundle: true,
  blocked: false,
  selfApproval: false,
}));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "admin" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: () => ({
    revision: 1,
    status: state.status,
    layoutRevision: 1,
    layoutId: "layout",
    preparationHash: "a".repeat(64),
    allowSelfApproval: state.selfApproval,
    fields: [],
    blockers: state.blocked ? ["Add a required signature for Tenant"] : [],
    bundle: state.bundle
      ? {
          id: "bundle",
          pdfHash: "b".repeat(64),
          pages: [{ pageIndex: 0 }],
          retainUntil: Date.now() + 10000,
        }
      : null,
    participants: [
      { key: "tenant", name: "Tenant", role: "Tenant", responsibility: "signer", stage: 1 },
      { key: "other", name: "Co-tenant", role: "Tenant", responsibility: "signer", stage: 1 },
      { key: "landlord", name: "Owner", role: "Landlord", responsibility: "signer", stage: 2 },
      { key: "viewer", name: "Observer", role: "Company", responsibility: "viewer", stage: 1 },
    ],
  }),
}));
import { SigningPreparation } from "./signing-preparation";
type Review = Parameters<typeof SigningPreparation>[0]["review"];
function review(): Review {
  return {
    agreement: { _id: "agreement", status: state.status, revision: 1 },
    approval:
      state.status === "awaiting_approval" ? { _id: "approval", requestedBy: "admin" } : null,
    decision: null,
    approvalCurrent: true,
    frozenPreparation: null,
  } as unknown as Review;
}
beforeEach(() => {
  state.authenticated = true;
  state.status = "draft";
  state.bundle = true;
  state.blocked = false;
  state.selfApproval = false;
});
test("preparation shows parallel stages and read-only responsibilities separately", () => {
  const html = renderToStaticMarkup(
    createElement(SigningPreparation, { review: review(), canEdit: true }),
  );
  expect(html).toContain("Stage 1 · parallel actions");
  expect(html).toContain("Stage 2");
  expect(html).toContain("Observer · Company · viewer · no signing fields");
  expect(html).toContain("Prepare signing fields");
  expect(html).toContain("Request internal approval");
  expect(html).not.toContain("Send invitation");
  expect(html).not.toContain("Finish and sign");
});
test("read-only staff see PDF review without mutation controls", () => {
  const html = renderToStaticMarkup(
    createElement(SigningPreparation, { review: review(), canEdit: false }),
  );
  expect(html).toContain("Review PDF and fields");
  expect(html).not.toContain("Request internal approval");
  expect(html).not.toContain("Approve preparation");
});
test("unreviewed preparation and self-approval cannot enable the approval button", () => {
  state.status = "awaiting_approval";
  const html = renderToStaticMarkup(
    createElement(SigningPreparation, { review: review(), canEdit: true }),
  );
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve preparation<\/button>/);
  expect(html).toContain("Another authorized administrator must approve");
});
test("incomplete preparation displays server blockers", () => {
  state.blocked = true;
  const html = renderToStaticMarkup(
    createElement(SigningPreparation, { review: review(), canEdit: true }),
  );
  expect(html).toContain("Add a required signature for Tenant");
  expect(html).not.toContain("I reviewed the current PDF");
});
test("signing preparation renders no private data after sign-out", () => {
  state.authenticated = false;
  expect(
    renderToStaticMarkup(createElement(SigningPreparation, { review: review(), canEdit: true })),
  ).toBe("");
});
