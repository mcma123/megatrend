import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ authenticated: true, issued: true, canSend: false }));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "admin" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: () => ({
    canSend: state.canSend,
    releaseBlockers: state.canSend ? [] : ["Signing release is switched off for this deployment"],
    frozenPreparationId: state.issued ? null : "frozen",
    transaction: state.issued
      ? {
          reference: "transaction-reference",
          status: "active",
          currentStage: 1,
          expiresAt: 1900000000000,
        }
      : null,
    invitations: state.issued
      ? [
          {
            id: "invitation",
            participantKey: "tenant",
            name: "<Tenant>",
            status: "active",
            version: 1,
            reminderEligible: true,
            lastEmailAt: 1800000000000,
            outcomes: [
              {
                intent: "correction_request",
                acceptedAt: 1800000100000,
                submissionHash: "f".repeat(64),
                reason: "<Unit number>",
              },
            ],
            deliveries: [
              { id: "delivery", kind: "invitation", status: "accepted", createdAt: 1800000000000 },
            ],
          },
        ]
      : [],
  }),
}));
import { SigningInvitations } from "./signing-invitations";
type Props = Parameters<typeof SigningInvitations>[0];
function render(canEdit = true) {
  return renderToStaticMarkup(
    createElement(SigningInvitations, {
      agreementId: "agreement" as Props["agreementId"],
      canEdit,
    }),
  );
}
beforeEach(() => {
  state.authenticated = true;
  state.issued = true;
  state.canSend = false;
});
test("provider acceptance remains distinct from verified email, document review and signing", () => {
  const html = render();
  expect(html).toContain("Provider accepted");
  expect(html).toContain("Email not yet verified");
  expect(html).not.toContain("Mail-server delivery confirmed");
  expect(html).toContain("&lt;Tenant&gt;");
  expect(html).not.toContain("<Tenant>");
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Remind outstanding participant<\/button>/);
  expect(html).toContain("Revoke access");
  expect(html).toContain("Check existing delivery");
  expect(html).toContain("Requested correction");
  expect(html).toContain("&lt;Unit number&gt;");
  expect(html).not.toContain(">Signed<");
});
test("read-only and expired MFA cannot show revocation or reconciliation controls", () => {
  const html = render(false);
  expect(html).toContain("Provider accepted");
  expect(html).not.toContain("Revoke access");
  expect(html).not.toContain("Check existing delivery");
});
test("no transaction is shown as unissued and never offers an enabled send control", () => {
  state.issued = false;
  const html = render();
  expect(html).toContain("no issued signing invitations");
  expect(html).not.toContain("Revoke access");
});
test("sign-out clears private ledger even if a subscription retains a result", () => {
  state.authenticated = false;
  expect(render()).toBe("");
});
test("blocked release explains why and never offers sending", () => {
  state.issued = false;
  const html = render();
  expect(html).toContain("External sending is blocked");
  expect(html).toContain("switched off for this deployment");
  expect(html).not.toContain("Release invitations");
});
test("released agreements need explicit confirmation before invitations are sent", () => {
  state.issued = false;
  state.canSend = true;
  const html = render();
  expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Release invitations<\/button>/);
  expect(html).toContain("are final");
  expect(render(false)).not.toContain("Release invitations");
});
test("bulk reminders and actionable failures are shown to MFA administrators", () => {
  state.canSend = true;
  const html = render();
  expect(html).toContain("Remind all outstanding participants");
  expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Remind all outstanding participants/);
});
