import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  authenticated: true,
  applied: false,
  active: false,
  paid: false,
  occupation: false,
}));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "admin" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    switch (getFunctionName(reference)) {
      case "signing:get":
        return {
          agreement: { status: "completed", revision: 1 },
          revision: { _id: "rev", title: "Lease", propertyId: "property" },
          participants: [
            { key: "owner", name: "<Owner>" },
            { key: "renter", name: "Renter" },
          ],
        };
      case "signingPortfolio:catalog":
        return {
          units: [{ _id: "unit", name: "<Unit>", propertyId: "property" }],
          parties: [
            { _id: "owner", kind: "owner", name: "<Owner>" },
            { _id: "renter", kind: "renter", name: "Renter" },
          ],
          leases: [],
          properties: [],
          truncated: false,
        };
      case "signingPortfolio:suggestedTerms":
        return null;
      case "signingPortfolio:state":
        return {
          application: state.applied
            ? {
                _id: "application",
                mode: "create",
                reviewHash: "a".repeat(64),
                approvedAt: 1800000000000,
              }
            : null,
          lease: state.applied
            ? {
                _id: "lease",
                signingApplicationId: "application",
                status: state.active ? "active" : "pending",
              }
            : null,
          payments: state.applied
            ? [
                {
                  _id: "payment",
                  purpose: "<Deposit>",
                  amountCents: 100000,
                  dueDate: "2027-01-01",
                  paidAt: state.paid ? 1800000000000 : undefined,
                },
              ]
            : [],
          signed: true,
          active: state.active,
          occupationAuthorised: state.occupation,
        };
      case "signingExports:list":
        return [{ id: "export", status: "unknown", createdAt: 1800000000000 }];
      default:
        throw new Error(`Unexpected query ${getFunctionName(reference)}`);
    }
  },
}));
import { SigningPortfolio } from "./signing-portfolio";
import { SigningReporting } from "./signing-reporting";
type Props = Parameters<typeof SigningPortfolio>[0];
const props = { agreementId: "agreement", tenantId: "company", canEdit: true } as Props;
const render = (canEdit = true) =>
  renderToStaticMarkup(createElement(SigningPortfolio, { ...props, canEdit }));
beforeEach(() => {
  state.authenticated = true;
  state.applied = false;
  state.active = false;
  state.paid = false;
  state.occupation = false;
});
test("completed agreements still require reviewed application; read-only controls and party labels are safe", () => {
  const html = render();
  expect(html).toContain("Preview exact portfolio changes");
  expect(html).toContain("&lt;Owner&gt;");
  expect(html).toContain("Applying signed terms never activates a lease");
  const readonly = render(false);
  expect(readonly).not.toContain("Preview exact portfolio changes");
  expect(readonly).toContain("Unsaved input is preserved");
});
test("payment recording and operational approvals remain separate, MFA-gated and escaped", () => {
  state.applied = true;
  state.paid = true;
  const html = render();
  expect(html).toContain("Approve lease activation");
  expect(html).toContain("Authorise occupation separately");
  expect(html).toContain("1 / 1 recorded paid");
  expect(html).toContain("&lt;Deposit&gt;");
  expect(html).not.toContain("Record payment evidence</button>");
  expect(render(false)).not.toContain("Approve lease activation");
  expect(render(false)).not.toContain("Authorise occupation separately");
});
test("company tools expose private handover and real report controls only to appropriate staff", () => {
  const html = renderToStaticMarkup(
    createElement(SigningReporting, { tenantId: props.tenantId, canEdit: true }),
  );
  expect(html).toContain("Request private handover");
  expect(html).toContain("Generate report");
  expect(html).toContain("Check existing export");
  expect(html).toContain("unknown");
  const readonly = renderToStaticMarkup(
    createElement(SigningReporting, { tenantId: props.tenantId, canEdit: false }),
  );
  expect(readonly).not.toContain("Request private handover</button>");
  expect(readonly).not.toContain("Check existing export");
});
test("signed-out renders expose neither portfolio state nor handover tools", () => {
  state.authenticated = false;
  expect(render()).toBe("");
  expect(
    renderToStaticMarkup(
      createElement(SigningReporting, { tenantId: props.tenantId, canEdit: true }),
    ),
  ).toBe("");
});
