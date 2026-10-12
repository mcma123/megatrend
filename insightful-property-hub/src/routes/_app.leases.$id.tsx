import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Archive, ArrowLeft, Pencil, RefreshCcw, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, FormError, LoadingState } from "@/components/portfolio/form-fields";
import { DraftInsightButton } from "@/components/insights/insight-editor-dialog";
import { LeaseFormDialog } from "@/components/portfolio/lease-form-dialog";
import {
  RENEWAL_STEPS,
  daysUntil,
  describeLeaseStatus,
  errorMessage,
  formatDate,
  formatTimeToExpiry,
  formatZAR,
  isLiveLease,
  renewalStepDate,
  termMonths,
} from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/leases/$id")({
  head: () => ({ meta: [{ title: "Lease · Cyphersoft OS" }] }),
  component: LeaseDetail,
});

function LeaseDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const lease = useQuery(api.leases.get, { leaseId: id as Id<"leases"> });
  const milestones = useQuery(api.automations.leaseMilestones, { leaseId: id as Id<"leases"> });
  const updateLease = useMutation(api.leases.update);
  const archiveLease = useMutation(api.leases.archive);
  const [busy, setBusy] = useState(false);

  if (lease === undefined) {
    return <LoadingState label="Loading lease…" />;
  }
  if (lease === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Lease not found"
          description="It may have been archived, or you don't have access to it."
          action={
            <Button asChild variant="outline">
              <Link to="/leases">All leases</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const live = isLiveLease(lease);

  const startRenewal = async () => {
    setBusy(true);
    try {
      await updateLease({
        leaseId: lease._id,
        startDate: lease.startDate,
        endDate: lease.endDate,
        monthlyRental: lease.monthlyRental,
        escalationPercent: lease.escalationPercent,
        noticePeriodMonths: lease.noticePeriodMonths,
        breakClause: lease.breakClause,
        renewalOption: lease.renewalOption,
        accountManagerName: lease.accountManagerName,
        status: "renewal_in_progress",
      });
      toast.success("Renewal started");
    } catch (renewError) {
      toast.error(errorMessage(renewError));
    } finally {
      setBusy(false);
    }
  };

  const onArchive = async () => {
    if (!window.confirm("Archive this lease? It will disappear from lists and the client portal."))
      return;
    setBusy(true);
    try {
      await archiveLease({ leaseId: lease._id });
      toast.success("Lease archived");
      void navigate({ to: "/leases" });
    } catch (archiveError) {
      toast.error(errorMessage(archiveError));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/leases"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Leases
      </Link>
      <PageHeader
        eyebrow={`${lease.client.name}${lease.property ? ` · ${lease.property.city}` : ""}`}
        title={lease.property?.name ?? "Lease"}
        description={`${formatDate(lease.startDate)} → ${formatDate(lease.endDate)}${lease.accountManagerName ? ` · ${lease.accountManagerName}` : ""}`}
        actions={
          lease.canEdit ? (
            <>
              {lease.status === "active" ? (
                <Button variant="outline" onClick={() => void startRenewal()} disabled={busy}>
                  <RefreshCcw className="h-4 w-4" /> Start renewal
                </Button>
              ) : null}
              <DraftInsightButton source={{ leaseId: lease._id }}>
                <Sparkles className="h-4 w-4" /> Draft insight with AI
              </DraftInsightButton>
              <LeaseFormDialog
                lease={lease}
                trigger={
                  <Button variant="outline">
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                }
              />
              <Button variant="outline" onClick={() => void onArchive()} disabled={busy}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { l: "Monthly", v: formatZAR(lease.monthlyRental) },
          { l: "Annual", v: formatZAR(lease.monthlyRental * 12) },
          { l: "Time to expiry", v: live ? formatTimeToExpiry(lease.endDate) : "—" },
          { l: "Status", v: describeLeaseStatus(lease, lease.renewalHorizonDays) },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {s.l}
            </div>
            <div className="mt-2 font-display text-xl">{s.v}</div>
          </Card>
        ))}
      </div>

      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Key terms</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Escalation</dt>
            <dd className="font-mono text-sm">
              {lease.escalationPercent !== undefined ? `${lease.escalationPercent}% per year` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Notice period</dt>
            <dd className="font-mono text-sm">
              {lease.noticePeriodMonths !== undefined ? `${lease.noticePeriodMonths} months` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Break clause</dt>
            <dd className="font-mono text-sm">{lease.breakClause ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Term</dt>
            <dd className="font-mono text-sm">
              {termMonths(lease.startDate, lease.endDate)} months
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Renewal option</dt>
            <dd className="font-mono text-sm">{lease.renewalOption ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <ClausesCard leaseId={lease._id} clauses={lease.clauses} canEdit={lease.canEdit} />

      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Renewal timeline</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Run by the renewal cadence automation; steps show what actually happened for this lease.
        </p>
        <ol className="mt-4 space-y-3">
          {RENEWAL_STEPS.map((step, i) => {
            const date = renewalStepDate(lease.endDate, step.daysBefore);
            const milestone = milestones?.find((item) => item.daysBefore === step.daysBefore);
            const due = live && daysUntil(date) <= 0;
            const state = milestone?.status ?? (due ? "due" : "upcoming");
            const stateLabel = {
              fired: "Done",
              skipped: "Skipped (caught up later)",
              due: "Due — runs at the next morning run",
              upcoming: "Upcoming",
            }[state];
            return (
              <li key={step.daysBefore} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={`grid h-8 w-8 place-items-center rounded-full border ${
                      state === "fired"
                        ? "border-primary bg-primary text-primary-foreground"
                        : state === "due"
                          ? "border-warning text-warning"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    <span className="font-mono text-[10px]">T-{step.daysBefore}</span>
                  </div>
                  {i < RENEWAL_STEPS.length - 1 && <div className="my-1 h-6 w-px bg-border" />}
                </div>
                <div className="pb-2">
                  <div className="text-sm font-medium">
                    {step.title}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      · {formatDate(date)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{step.detail}</div>
                  {live ? (
                    <div
                      className={`text-[11px] ${state === "fired" ? "text-success" : state === "due" ? "text-warning" : "text-muted-foreground"}`}
                    >
                      {stateLabel}
                      {state === "fired" && milestone?.actionId ? (
                        <>
                          {" · "}
                          <Link to="/tasks" className="underline-offset-2 hover:underline">
                            view task
                          </Link>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function ClausesCard({
  leaseId,
  clauses,
  canEdit,
}: {
  leaseId: Id<"leases">;
  clauses: Array<{ _id: Id<"leaseClauses">; title: string; detail: string }>;
  canEdit: boolean;
}) {
  const addClause = useMutation(api.leases.addClause);
  const removeClause = useMutation(api.leases.removeClause);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addClause({ leaseId, title, detail });
      setTitle("");
      setDetail("");
    } catch (addError) {
      setError(errorMessage(addError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="surface-elevated mt-6 p-6">
      <h3 className="font-display text-lg">Critical clauses</h3>
      {clauses.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No clauses recorded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {clauses.map((clause) => (
            <li key={clause._id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <div className="text-sm font-medium">{clause.title}</div>
                <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {clause.detail}
                </div>
              </div>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${clause.title}`}
                  onClick={() => {
                    void removeClause({ clauseId: clause._id }).catch((removeError) =>
                      toast.error(errorMessage(removeError)),
                    );
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={submit} className="mt-4 space-y-2 border-t border-border pt-4">
          <Input
            placeholder="Clause title, e.g. Reinstatement"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Textarea
            placeholder="What the clause says"
            rows={2}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            required
          />
          <FormError message={error} />
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Adding…" : "Add clause"}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
