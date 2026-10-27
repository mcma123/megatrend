import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: true,
  hasCompany: true,
  policyRecorded: false,
  recent: true,
}));

vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: { isPlatformAdmin: state.admin } }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "signingMfaState:status")
      return {
        configured: true,
        enrolled: true,
        recent: state.recent,
        expiresAt: Date.now() + 300000,
        recoveryCodesRemaining: 8,
      };
    if (name === "clients:list")
      return state.hasCompany ? [{ tenantId: "company-test", name: "Test Company" }] : [];
    if (name === "signing:readiness")
      return {
        canIssue: false,
        releaseBlockers: ["Signing release is switched off for this deployment"],
        policyBlockers: state.policyRecorded ? [] : ["Legal review has not been recorded"],
        implementationBlockers: ["Certificate-backed finalisation is not implemented"],
        operationalBlockers: ["Email delivery has not passed acceptance"],
      };
    if (name === "signingOperations:alerts") return [];
    if (name === "signingRelease:get")
      return {
        deploymentMode: "off",
        record: null,
        blockers: ["Signing release is switched off for this deployment"],
      };
    throw new Error(`Unexpected query: ${name}`);
  },
  usePaginatedQuery: () => ({
    results: [
      {
        _id: "agreement-test",
        title: "Lease <script>alert(1)</script>",
        status: "draft",
        revision: 2,
        updatedAt: 0,
        tracking: {
          transactionStatus: null,
          currentStage: null,
          expiresAt: null,
          completed: 0,
          total: 0,
          openAlerts: 0,
          critical: false,
        },
      },
    ],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));

import { AgreementWorkspace } from "./agreement-workspace";

beforeEach(() => {
  state.admin = true;
  state.hasCompany = true;
  state.policyRecorded = false;
  state.recent = true;
});

describe("agreement workspace release boundaries", () => {
  test("an administrator without recent MFA sees verification instead of privileged controls", () => {
    state.recent = false;
    const html = renderToStaticMarkup(createElement(AgreementWorkspace));
    expect(html).not.toContain("New draft");
    expect(html).not.toContain("Record policy references</button>");
    expect(html).toContain("Verify your authenticator");
  });
  test("administrator sees release blockers and operations while external sending stays unavailable", () => {
    const html = renderToStaticMarkup(createElement(AgreementWorkspace));
    expect(html).toContain("New draft");
    expect(html).toContain("Controlled release");
    expect(html).toContain("External sending is not released");
    expect(html).toContain("Signing release is switched off for this deployment");
    expect(html).toContain("Signing operations");
    expect(html).not.toMatch(/<button[^>]*>[^<]*(Send invitation|Finish and sign|Approve)/);
    expect(html).toContain("Revision 2");
  });

  test("read-only company staff receive the register without administrator create controls", () => {
    state.admin = false;
    const html = renderToStaticMarkup(createElement(AgreementWorkspace));
    expect(html).toContain("Agreement register");
    expect(html).not.toContain("New draft");
  });

  test("recording policy references does not remove operational release blockers", () => {
    state.policyRecorded = true;
    const html = renderToStaticMarkup(createElement(AgreementWorkspace));
    expect(html).toContain("External sending is not released");
    expect(html).toContain("Certificate-backed finalisation is not implemented");
    expect(html).toContain("Email delivery has not passed acceptance");
  });

  test("draft titles are escaped and a missing company cannot create an agreement", () => {
    const html = renderToStaticMarkup(createElement(AgreementWorkspace));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    state.hasCompany = false;
    const empty = renderToStaticMarkup(createElement(AgreementWorkspace));
    expect(empty).not.toContain("New draft");
    expect(empty).toContain("Select or create a client company");
  });
});
