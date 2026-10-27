import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import {
  demoReducer,
  demoRecord,
  fieldPosition,
  initialDemo,
  type DemoAction,
  type DemoState,
} from "./signing-demo-state";

const auth = vi.hoisted(() => ({ staff: true }));
vi.mock("@/lib/auth-session", () => ({
  useCyphersoftAuth: () => ({
    profile: auth.staff ? { userId: "presenter", isStaff: true, isPlatformAdmin: true } : null,
  }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => {
    throw new Error("Demo must not use live writes");
  },
  useAction: () => {
    throw new Error("Demo must not invoke services");
  },
  useQuery: () => {
    throw new Error("Demo must use sample data");
  },
}));
import { SigningDemo } from "./signing-demo";
beforeEach(() => {
  auth.staff = true;
});
const reduce = (state: DemoState, ...actions: DemoAction[]) => actions.reduce(demoReducer, state);
function invitations() {
  return reduce(
    initialDemo(),
    { type: "prepare" },
    { type: "sample_fields" },
    { type: "review" },
    { type: "approve", reviewed: true },
  );
}
function completed() {
  let state = invitations();
  for (const party of ["renter", "owner"] as const)
    state = reduce(
      state,
      { type: "open_signer", party },
      { type: "verify", code: "123456" },
      { type: "sign", name: state.parties[party].name, reviewed: true, consent: true },
    );
  return demoReducer(state, { type: "complete" });
}
test("staff can start a populated demo without MFA, company records or service hooks", () => {
  const html = renderToStaticMarkup(createElement(SigningDemo));
  expect(html).toContain("Demo mode");
  expect(html).toContain("No setup required");
  expect(html).toContain("Prepare sample agreement");
  expect(html).toContain("Alex Tenant");
  expect(html).not.toContain("Signing MFA needs");
  expect(html).not.toContain("Set up authenticator");
  auth.staff = false;
  expect(renderToStaticMarkup(createElement(SigningDemo))).toBe("");
});
test("full demonstration moves through preparation, sequential signing and clearly simulated completion", () => {
  const state = completed();
  expect(state.step).toBe(6);
  expect(Object.keys(state.signatures)).toHaveLength(2);
  expect(state.consented).toEqual(["renter", "owner"]);
  expect(state.events.join(" ")).toContain("No email was sent");
  expect(demoRecord(state)).toMatchObject({
    demo: true,
    legallySigned: false,
    externalEmailSent: false,
    productionRecordsCreated: false,
    simulatedComplete: true,
  });
});
test("fields, explicit approval, sample OTP, consent and signer sequence are enforced", () => {
  let state = reduce(initialDemo(), { type: "prepare" }, { type: "review" });
  expect(state.step).toBe(1);
  expect(state.error).toContain("both");
  state = reduce(
    state,
    { type: "sample_fields" },
    { type: "review" },
    { type: "approve", reviewed: false },
  );
  expect(state.step).toBe(2);
  state = reduce(
    state,
    { type: "approve", reviewed: true },
    { type: "open_signer", party: "owner" },
  );
  expect(state.step).toBe(3);
  expect(state.error).toContain("renter signs first");
  state = reduce(
    state,
    { type: "open_signer", party: "renter" },
    { type: "verify", code: "999999" },
    { type: "sign", name: "Example", reviewed: true, consent: true },
  );
  expect(state.signatures.renter).toBeUndefined();
  state = reduce(
    state,
    { type: "verify", code: "123456" },
    { type: "sign", name: "Example", reviewed: true, consent: false },
  );
  expect(state.step).toBe(4);
  expect(state.error).toContain("consent");
  expect(demoReducer(state, { type: "complete" }).step).toBe(4);
});
test("portfolio effects are idempotent and payment never activates a lease or authorises occupation", () => {
  let state = completed();
  expect(state.applied).toBe(false);
  expect(state.active).toBe(false);
  expect(state.occupation).toBe(false);
  state = reduce(state, { type: "apply" }, { type: "apply" }, { type: "pay" }, { type: "pay" });
  expect(state.events.filter((s) => s.includes("added to the demo register"))).toHaveLength(1);
  expect(state.paid).toBe(true);
  expect(state.active).toBe(false);
  expect(state.occupation).toBe(false);
  state = reduce(state, { type: "activate" });
  expect(state.active).toBe(true);
  expect(state.occupation).toBe(false);
  state = reduce(state, { type: "occupy" });
  expect(state.occupation).toBe(true);
  expect(demoReducer(state, { type: "reset" })).toEqual(initialDemo());
});
test("correction clears simulated submissions, decline stops progress, and approval freezes the sample", () => {
  let state = reduce(
    invitations(),
    { type: "open_signer", party: "renter" },
    { type: "verify", code: "123456" },
    { type: "sign", name: "Alex", reviewed: true, consent: true },
    { type: "open_signer", party: "owner" },
    { type: "correction" },
  );
  expect(state.step).toBe(2);
  expect(state.signatures).toEqual({});
  expect(state.verified).toEqual([]);
  state = reduce(
    state,
    { type: "approve", reviewed: true },
    { type: "edit", values: { title: "Changed after approval" } },
  );
  expect(state.title).toBe(initialDemo().title);
  state = reduce(
    state,
    { type: "open_signer", party: "renter" },
    { type: "decline" },
    { type: "open_signer", party: "owner" },
  );
  expect(state.declined).toBe(true);
  expect(state.step).toBe(3);
});
test("sample edits are escaped, invalid terms block progression and field positions stay on the page", () => {
  let state = reduce(
    initialDemo(),
    { type: "edit", values: { rent: "oops" } },
    { type: "prepare" },
  );
  expect(state.step).toBe(0);
  expect(state.error).toContain("rand");
  expect(fieldPosition(-100, Infinity)).toEqual({ x: 2, y: 4 });
  state = reduce(
    initialDemo(),
    { type: "prepare" },
    { type: "sample_fields" },
    { type: "move", id: 1, x: 200, y: 200 },
  );
  expect(state.fields[0]).toMatchObject({ x: 69, y: 92 });
  expect(demoRecord(state).notice).toContain("NOT A SIGNED AGREEMENT");
});
