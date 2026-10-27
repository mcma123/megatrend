import { createFileRoute } from "@tanstack/react-router";
import { AgreementWorkspace } from "@/components/signing/agreement-workspace";

export const Route = createFileRoute("/_app/agreements")({
  head: () => ({ meta: [{ title: "Agreements · Cyphersoft OS" }] }),
  component: AgreementWorkspace,
});
