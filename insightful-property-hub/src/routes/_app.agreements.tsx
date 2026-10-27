import { createFileRoute } from "@tanstack/react-router";
import { AgreementWorkspace } from "@/components/signing/agreement-workspace";
import { SigningDemo } from "@/components/signing/signing-demo";

export const Route = createFileRoute("/_app/agreements")({
  validateSearch: (search: Record<string, unknown>): { demo?: boolean } =>
    search.demo === true || search.demo === "true" || search.demo === "1" ? { demo: true } : {},
  head: () => ({ meta: [{ title: "Agreements · Cyphersoft OS" }] }),
  component: AgreementsPage,
});

function AgreementsPage() {
  const { demo } = Route.useSearch();
  return demo ? <SigningDemo /> : <AgreementWorkspace />;
}
