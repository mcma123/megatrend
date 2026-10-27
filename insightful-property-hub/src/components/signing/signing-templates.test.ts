import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ authenticated: true, available: true }));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({ profile: state.authenticated ? { userId: "admin" } : null }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useConvex: () => ({ query: vi.fn().mockResolvedValue(undefined) }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(reference);
    if (name === "signingTemplates:library")
      return {
        templates: [
          {
            id: "t1",
            name: "Residential <starter>",
            kind: "residential_lease",
            category: "residential_lease",
            retired: false,
            approvedVersionId: "v1",
            versions: [
              {
                id: "v2",
                version: 2,
                status: "draft",
                revision: 1,
                contentHash: "a".repeat(64),
                legalReference: null,
                updatedAt: 1,
                approvedAt: null,
              },
              {
                id: "v1",
                version: 1,
                status: "approved",
                revision: 3,
                contentHash: "b".repeat(64),
                legalReference: "L1",
                updatedAt: 1,
                approvedAt: 2,
              },
            ],
          },
        ],
        clauses: [
          {
            id: "c1",
            title: "Deposit",
            retired: false,
            approvedVersionId: null,
            versions: [
              {
                id: "cv1",
                version: 1,
                status: "draft",
                revision: 1,
                contentHash: "c".repeat(64),
                legalReference: null,
                updatedAt: 1,
                approvedAt: null,
              },
            ],
          },
        ],
      };
    if (name === "signingTemplates:available")
      return state.available
        ? [{ templateId: "t1", name: "Residential", versionId: "v1", version: 1 }]
        : [];
    if (name === "signingTemplates:generations")
      return [
        {
          id: "g1",
          status: "attached",
          error: null,
          template: "Residential <starter>",
          version: 1,
          createdAt: 1800000000000,
          inputHash: "d".repeat(64),
          htmlHash: "e".repeat(64),
          pdfHash: "f".repeat(64),
          pageCount: 4,
          rendererVersion: "cyphersoft-template-html-v1",
          pdfRenderer: "gotenberg-chromium+pypdf-normalized-v1",
          annexures: ["Annexure A.pdf"],
        },
      ];
    throw new Error(`Unexpected query: ${name}`);
  },
}));
import { SigningTemplates } from "./signing-templates";
import { SigningGenerate } from "./signing-generate";

beforeEach(() => {
  state.authenticated = true;
  state.available = true;
});
test("library lists versions, escapes names and offers starters only to MFA administrators", () => {
  const html = renderToStaticMarkup(
    createElement(SigningTemplates, { tenantId: "tenant" as never, canEdit: true }),
  );
  expect(html).toContain("Residential &lt;starter&gt;");
  expect(html).toContain("approved v1");
  expect(html).toContain("draft v2");
  expect(html).toContain("placeholder wording only");
  expect(html).toContain("Install starter structures");
  const readOnly = renderToStaticMarkup(
    createElement(SigningTemplates, { tenantId: "tenant" as never, canEdit: false }),
  );
  expect(readOnly).not.toContain("Install starter structures");
  expect(readOnly).not.toContain("Create template");
});
test("generation panel lists approved templates and records versions and hashes", () => {
  const props = {
    agreementId: "a" as never,
    revision: 1,
    fileRevision: 0,
    status: "draft",
    canEdit: true,
  };
  const html = renderToStaticMarkup(createElement(SigningGenerate, props));
  expect(html).toContain("Residential (v1)");
  expect(html).toContain("f".repeat(64));
  expect(html).toContain("cyphersoft-template-html-v1");
  expect(html).toContain("Annexure A.pdf");
  expect(html).toContain("Check reproducibility");
  state.available = false;
  expect(renderToStaticMarkup(createElement(SigningGenerate, props))).toContain(
    "No approved template",
  );
  expect(
    renderToStaticMarkup(createElement(SigningGenerate, { ...props, canEdit: false })),
  ).not.toContain("Choose an approved template");
});
test("sign-out clears the generation panel", () => {
  state.authenticated = false;
  expect(
    renderToStaticMarkup(
      createElement(SigningGenerate, {
        agreementId: "a" as never,
        revision: 1,
        fileRevision: 0,
        status: "draft",
        canEdit: true,
      }),
    ),
  ).toBe("");
});
