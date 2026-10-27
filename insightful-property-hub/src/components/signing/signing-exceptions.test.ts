import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  paused: false,
  holds: [] as {
    id: string;
    reason: string;
    placedAt: number;
    releasedAt: number | null;
    releaseReason: string | null;
  }[],
  suspended: false,
}));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "admin" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "signingExceptions:status")
      return {
        status: "partially_signed",
        transaction: {
          status: state.paused ? "paused" : "active",
          expiresAt: 1900000000000,
          currentStage: 1,
        },
        canVoid: true,
        canExtend: true,
        canResume: state.paused,
        canResumeStage: false,
        canReplace: true,
        replacesAgreementId: null,
        replacedByAgreementId: null,
        holds: state.holds,
      };
    if (name === "signingRelease:get")
      return {
        deploymentMode: "pilot",
        record: {
          revision: 2,
          mode: "pilot",
          pilotRecipients: ["@example.test"],
          legalSignOffReference: "legal",
          acceptanceReference: "acceptance",
          recordedAt: 1,
          suspendedAt: state.suspended ? 2 : null,
          suspensionReason: state.suspended ? "<Incident>" : null,
        },
        blockers: state.suspended ? ["Signing release is suspended for this company"] : [],
      };
    if (name === "signingOperations:alerts")
      return [
        {
          id: "alert",
          kind: "delivery_unresolved",
          severity: "critical",
          message: "invitation email unknown",
          company: "Company",
          tenantId: "tenant",
          agreementId: "agreement-12345678",
          firstSeenAt: 1800000000000,
          lastSeenAt: 1800000000000,
        },
      ];
    throw new Error(`Unexpected query: ${name}`);
  },
}));
import { SigningExceptions } from "./signing-exceptions";
import { SigningRelease } from "./signing-release";
import { SigningOperations } from "./signing-operations";

const exceptions = (canEdit = true) =>
  renderToStaticMarkup(
    createElement(SigningExceptions, {
      agreementId: "agreement" as Parameters<typeof SigningExceptions>[0]["agreementId"],
      canEdit,
    }),
  );
beforeEach(() => {
  state.authenticated = true;
  state.paused = false;
  state.holds = [];
  state.suspended = false;
});
test("issued agreements offer reasoned exceptions only to MFA administrators", () => {
  const html = exceptions();
  for (const label of [
    "Extend deadline",
    "Create replacement draft",
    "Cancel agreement",
    "Place hold",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Resume signing");
  expect(exceptions(false)).not.toContain("Cancel agreement");
});
test("a paused transaction can resume and active holds are listed and releasable", () => {
  state.paused = true;
  state.holds = [
    { id: "hold", reason: "<Dispute>", placedAt: 1, releasedAt: null, releaseReason: null },
  ];
  const html = exceptions();
  expect(html).toContain("paused for a correction request");
  expect(html).toContain("Resume signing");
  expect(html).toContain("&lt;Dispute&gt;");
  expect(html).toContain("Release hold");
  expect(html).not.toContain("Place hold");
});
test("release panel shows suspension and blockers with escaped reasons", () => {
  state.suspended = true;
  const html = renderToStaticMarkup(
    createElement(SigningRelease, {
      tenantId: "tenant" as Parameters<typeof SigningRelease>[0]["tenantId"],
      canEdit: true,
    }),
  );
  expect(html).toContain("suspended (&lt;Incident&gt;)");
  expect(html).toContain("Signing release is suspended for this company");
  expect(html).toContain("Update release");
  expect(html).not.toContain("Suspend sending");
});
test("operations alerts show severity and codes without participant data", () => {
  const html = renderToStaticMarkup(createElement(SigningOperations));
  expect(html).toContain("critical");
  expect(html).toContain("delivery unresolved");
  expect(html).toContain("12345678");
});
test("sign-out clears the exceptions card", () => {
  state.authenticated = false;
  expect(exceptions()).toBe("");
});
