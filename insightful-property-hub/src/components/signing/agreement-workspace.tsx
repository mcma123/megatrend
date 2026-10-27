import { useEffect, useRef, useState } from "react";
import { SigningSecurity } from "./signing-security";
import { SigningPolicy } from "./signing-policy";
import { SigningAttachments } from "./signing-attachments";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { FilePenLine, History, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  partyContent,
  type SigningCategory,
  type SigningDraft,
  type SigningStatus,
} from "../../../../convex/lib/signing";
import { SigningFiles } from "./signing-files";
import { SigningPreparation } from "./signing-preparation";
import { SigningInvitations } from "./signing-invitations";
import { SigningFinalisation } from "./signing-finalisation";
import { SigningExceptions } from "./signing-exceptions";
import { SigningRelease } from "./signing-release";
import { SigningOperations } from "./signing-operations";
import { SigningTemplates } from "./signing-templates";
import { SigningGenerate } from "./signing-generate";
import { SigningPortfolio } from "./signing-portfolio";
import { SigningReporting } from "./signing-reporting";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";

const categories: Record<SigningCategory, string> = {
  residential_lease: "Residential lease",
  commercial_lease: "Commercial lease",
  renewal: "Renewal",
  general_contract: "General contract",
  suretyship: "Suretyship — legal review required",
  property_sale: "Property sale — unsupported",
  long_term_lease: "Long-term lease — legal review required",
  will: "Will — unsupported",
  bill_of_exchange: "Bill of exchange — unsupported",
  other: "Other — legal review required",
};
const statusLabel = (status: string) => status.replaceAll("_", " ");
const errorMessage = (error: unknown) =>
  error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "The change could not be saved. Please try again.";
const requestId = () => crypto.randomUUID();

function emptyDraft(): SigningDraft {
  return { title: "", category: "general_contract", notes: "", participants: [] };
}

export function AgreementWorkspace() {
  const { profile } = useCyphersoftAuth();
  const security = useQuery(api.signingMfaState.status, profile?.isPlatformAdmin ? {} : "skip");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!security?.expiresAt) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, security.expiresAt - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [security?.expiresAt]);
  const companies = useQuery(api.clients.list, {});
  const [companyId, setCompanyId] = useState<Id<"tenants"> | null>(null);
  const [selected, setSelected] = useState<Id<"signingAgreements"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"agreements" | "templates" | "portfolio">("agreements");
  const tenantId = companyId ?? companies?.[0]?.tenantId ?? null;
  const canEdit =
    profile?.isPlatformAdmin === true &&
    security?.recent === true &&
    (security.expiresAt ?? 0) > clock;
  return (
    <>
      <PageHeader
        eyebrow="Contracts and leases"
        title="Agreements"
        description="Prepare agreements and participants, and follow each revision."
        actions={
          canEdit && tenantId ? (
            <Button
              onClick={() => {
                setSelected(null);
                setCreating(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New draft
            </Button>
          ) : null
        }
      />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-primary/5 p-5">
        <div>
          <p className="font-semibold">Present the full signing workflow today</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a ready-made client demo with sample documents, signer journeys and portfolio
            handover. No MFA or service setup needed.
          </p>
        </div>
        <Button asChild>
          <a href="/agreements?demo=1">Start client demo</a>
        </Button>
      </Card>
      {profile?.isPlatformAdmin && <SigningSecurity status={security} />}
      {profile?.isPlatformAdmin && (
        <div className="mb-6">
          <SigningOperations />
        </div>
      )}
      <Card className="mb-6 flex gap-3 border-amber-500/30 bg-amber-500/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="text-sm">
          <p className="font-medium">Controlled release</p>
          <p className="mt-1 text-muted-foreground">
            Invitations can be sent only when the deployment release key, the company&apos;s
            recorded release (pilot or live), a complete policy and configured services all pass.
            Pilot releases send only to allowlisted addresses.
          </p>
        </div>
      </Card>
      <div className="mb-6 max-w-sm">
        <Field label="Client company" htmlFor="signing-company">
          <NativeSelect
            id="signing-company"
            value={tenantId ?? ""}
            disabled={!companies?.length}
            onChange={(event) => {
              setCompanyId(event.target.value as Id<"tenants">);
              setSelected(null);
              setCreating(false);
            }}
          >
            {!companies?.length && (
              <option value="">
                {companies ? "No companies available" : "Loading companies…"}
              </option>
            )}
            {companies?.map((company) => (
              <option key={company.tenantId} value={company.tenantId}>
                {company.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {tenantId && (
        <div className="mb-4 flex gap-2" role="tablist" aria-label="Signing workspace">
          {(
            [
              ["agreements", "Agreements"],
              ["templates", "Templates & clauses"],
              ["portfolio", "Portfolio & reports"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              role="tab"
              aria-selected={view === value}
              size="sm"
              variant={view === value ? "default" : "outline"}
              onClick={() => setView(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {tenantId && view === "portfolio" ? (
        <SigningReporting key={`portfolio:${tenantId}`} tenantId={tenantId} canEdit={canEdit} />
      ) : tenantId && view === "templates" ? (
        <SigningTemplates key={`templates:${tenantId}`} tenantId={tenantId} canEdit={canEdit} />
      ) : tenantId ? (
        <CompanyWorkspace
          key={tenantId}
          tenantId={tenantId}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setCreating(false);
          }}
          creating={creating}
          onCreated={(id) => {
            setSelected(id);
            setCreating(false);
          }}
          onCloseCreate={() => setCreating(false)}
          canEdit={canEdit}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Select or create a client company to prepare an agreement.
        </p>
      )}
    </>
  );
}

function CompanyWorkspace({
  tenantId,
  selected,
  onSelect,
  creating,
  onCreated,
  onCloseCreate,
  canEdit,
}: {
  tenantId: Id<"tenants">;
  selected: Id<"signingAgreements"> | null;
  onSelect: (id: Id<"signingAgreements">) => void;
  creating: boolean;
  onCreated: (id: Id<"signingAgreements">) => void;
  onCloseCreate: () => void;
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<SigningStatus | "all">("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const { results, status, loadMore } = usePaginatedQuery(
    api.signing.list,
    { tenantId, ...(filter === "all" ? {} : { status: filter }) },
    { initialNumItems: 20 },
  );
  const readiness = useQuery(api.signing.readiness, { tenantId });
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
      <div className="space-y-5">
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Agreement dashboard</h2>
          <p className="text-xs text-muted-foreground">
            Counts for the {results.length} loaded agreements
            {filter !== "all" ? ` in ${statusLabel(filter)}` : ""}. Load more for older records.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Drafts", "draft"],
                ["Approval", "awaiting_approval"],
                ["Approved", "ready_to_send"],
                ["Signing", "awaiting_signatures"],
                ["Partly signed", "partially_signed"],
                ["Finalising", "finalising"],
              ] as const
            ).map(([label, value]) => (
              <div key={value} className="rounded-md border p-2">
                <p className="text-xl font-medium">
                  {results.filter((a) => a.status === value).length}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={attentionOnly}
              onChange={(event) => setAttentionOnly(event.target.checked)}
            />
            Needs attention only ({results.filter((a) => a.tracking.openAlerts > 0).length} loaded)
          </label>
          <Field label="Agreement status" htmlFor="agreement-status-filter">
            <NativeSelect
              id="agreement-status-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as SigningStatus | "all")}
            >
              <option value="all">All agreements</option>
              {[
                "draft",
                "awaiting_approval",
                "ready_to_send",
                "voided",
                "awaiting_signatures",
                "partially_signed",
                "finalising",
                "completed",
                "declined",
                "expired",
                "superseded",
              ].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <h2 className="font-medium">Agreement register</h2>
          </div>
          {status === "LoadingFirstPage" ? (
            <p className="p-4 text-sm text-muted-foreground">Loading agreements…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No agreements yet. Start with a draft.
            </p>
          ) : (
            <ul className="divide-y">
              {results
                .filter((agreement) => !attentionOnly || agreement.tracking.openAlerts > 0)
                .map((agreement) => (
                  <li key={agreement._id}>
                    <button
                      className={`w-full p-4 text-left transition-colors hover:bg-muted/50 ${selected === agreement._id ? "bg-muted" : ""}`}
                      onClick={() => onSelect(agreement._id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-words text-sm font-medium">{agreement.title}</span>
                        <Badge variant="secondary" className="shrink-0 capitalize">
                          {statusLabel(agreement.status)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Revision {agreement.revision} ·{" "}
                        {new Date(agreement.updatedAt).toLocaleDateString()}
                      </p>
                      {agreement.tracking.transactionStatus && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {agreement.tracking.completed}/{agreement.tracking.total} finished · stage{" "}
                          {agreement.tracking.currentStage} · due{" "}
                          {new Date(agreement.tracking.expiresAt!).toLocaleDateString()}
                        </p>
                      )}
                      {agreement.tracking.openAlerts > 0 && (
                        <Badge
                          variant={agreement.tracking.critical ? "destructive" : "secondary"}
                          className="mt-1"
                        >
                          Needs attention ({agreement.tracking.openAlerts})
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <div className="p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(20)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </Card>
        {readiness && (
          <Card className="p-4">
            <h2 className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4" />
              Signing readiness
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {readiness.canIssue
                ? "External sending is released for this company. Pilot allowlists still apply per agreement."
                : "External sending is not released. Policy and release references are administrator attestations."}
            </p>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              {[...readiness.releaseBlockers, ...readiness.implementationBlockers].map(
                (blocker) => (
                  <li className="flex gap-2" key={blocker}>
                    <span aria-hidden="true">•</span>
                    {blocker}
                  </li>
                ),
              )}
            </ul>
            <p className="mt-3 text-xs font-medium">Attest before recording a release</p>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {readiness.operationalBlockers.map((item) => (
                <li className="flex gap-2" key={item}>
                  <span aria-hidden="true">•</span>
                  {item}
                </li>
              ))}
            </ul>
            <SigningPolicy
              tenantId={tenantId}
              policy={readiness.policy ?? null}
              canEdit={canEdit}
            />
            <SigningRelease tenantId={tenantId} canEdit={canEdit} />
          </Card>
        )}
      </div>
      <div>
        {creating ? (
          <DraftEditor
            key="new"
            tenantId={tenantId}
            onSaved={onCreated}
            onCancel={onCloseCreate}
            disabledBySecurity={!canEdit}
          />
        ) : selected ? (
          <AgreementDetail
            key={selected}
            agreementId={selected}
            tenantId={tenantId}
            canEdit={canEdit}
            onOpenAgreement={onSelect}
          />
        ) : (
          <Card className="grid min-h-64 place-items-center p-8 text-center">
            <div>
              <FilePenLine className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h2 className="font-medium">Prepare a contract or lease</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Select an agreement to review its draft, participants, and history.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

type AgreementData = {
  agreement: Doc<"signingAgreements">;
  revision: Doc<"signingRevisions">;
  participants: Doc<"signingParticipants">[];
};

function toDraft(data: AgreementData): SigningDraft {
  const { title, category, propertyId, leaseId, notes, signatureMethod } = data.revision;
  return {
    title,
    category,
    ...(propertyId ? { propertyId } : {}),
    ...(leaseId ? { leaseId } : {}),
    notes,
    ...(signatureMethod ? { signatureMethod } : {}),
    ...(data.revision.portfolioContext ? { portfolioContext: data.revision.portfolioContext } : {}),
    participants: data.participants.map(partyContent),
  };
}

function AgreementDetail({
  agreementId,
  tenantId,
  canEdit,
  onOpenAgreement,
}: {
  agreementId: Id<"signingAgreements">;
  tenantId: Id<"tenants">;
  canEdit: boolean;
  onOpenAgreement: (id: Id<"signingAgreements">) => void;
}) {
  const data = useQuery(api.signing.get, { agreementId });
  const {
    results: history,
    status,
    loadMore,
  } = usePaginatedQuery(api.signing.events, { agreementId }, { initialNumItems: 10 });
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voidDraft = useMutation(api.signing.voidDraft);
  const verifyAudit = useAction(api.signingCheckpoints.verify);
  const retryCheckpoint = useMutation(api.signingCheckpoints.retry);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  if (!data) return <Card className="p-6 text-sm text-muted-foreground">Loading agreement…</Card>;
  if (editing)
    return (
      <DraftEditor
        tenantId={tenantId}
        initial={data}
        disabledBySecurity={!canEdit}
        onSaved={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  return (
    <div className="space-y-5">
      <SigningGenerate
        agreementId={agreementId}
        revision={data.agreement.revision}
        fileRevision={data.agreement.fileRevision ?? 0}
        status={data.agreement.status}
        canEdit={canEdit}
      />
      <SigningFiles agreement={data.agreement} canEdit={canEdit} />
      <SigningPreparation review={data} canEdit={canEdit} />
      <SigningInvitations agreementId={agreementId} canEdit={canEdit} />
      <SigningAttachments agreementId={agreementId} canEdit={canEdit} />
      <SigningFinalisation agreementId={agreementId} canEdit={canEdit} />
      <SigningPortfolio agreementId={agreementId} tenantId={tenantId} canEdit={canEdit} />
      <SigningExceptions
        agreementId={agreementId}
        canEdit={canEdit}
        onOpenAgreement={onOpenAgreement}
      />
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-medium">{data.revision.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {categories[data.revision.category]} · Revision {data.agreement.revision}
            </p>
          </div>
          <Badge className="capitalize" variant="secondary">
            {statusLabel(data.agreement.status)}
          </Badge>
        </div>
        {data.revision.notes && (
          <p className="mt-4 whitespace-pre-wrap break-words text-sm">{data.revision.notes}</p>
        )}
        <div className="mt-5 border-t pt-4">
          <h3 className="text-sm font-medium">Participants</h3>
          {data.participants.length ? (
            <ul className="mt-2 divide-y">
              {data.participants.map((p) => (
                <li key={p.key} className="py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-1">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Stage {p.stage} · {p.responsibility}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {p.email} · {p.role}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No participants added yet.</p>
          )}
        </div>
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Revision reference</summary>
          <p className="mt-2 break-all">Agreement: {data.agreement._id}</p>
          <p className="mt-1 break-all">Content hash: {data.revision.contentHash}</p>
          <p className="mt-2">
            This draft hash is a consistency check. The agreement has not been signed or
            independently sealed.
          </p>
        </details>
        {data.agreement.status === "voided" && (
          <p className="mt-4 text-sm text-muted-foreground">
            Cancellation reason: {data.agreement.voidReason}
          </p>
        )}
        {canEdit && data.agreement.status === "draft" && (
          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit draft
            </Button>
            <Button variant="ghost" onClick={() => setCancelling(!cancelling)}>
              Cancel draft
            </Button>
          </div>
        )}
        {canEdit && cancelling && data.agreement.status === "draft" && (
          <form
            className="mt-4 space-y-3 rounded-lg border p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await voidDraft({ agreementId, expectedRevision: data.agreement.revision, reason });
                setCancelling(false);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Why is this draft being cancelled?" htmlFor="void-reason">
              <Textarea
                id="void-reason"
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <FormError message={error} />
            <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
              Confirm cancellation
            </Button>
          </form>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Protected audit checkpoint</h2>
        <p className="text-sm text-muted-foreground">
          {data.checkpoint
            ? `Event ${data.checkpoint.sequence}: ${statusLabel(data.checkpoint.status)}.`
            : "No protected checkpoint is available."}{" "}
          {!data.checkpointConfigured &&
            "Configure the independent audit service to store and verify checkpoints."}
        </p>
        {data.checkpoint?.error && (
          <p role="alert" className="text-sm text-destructive">
            {data.checkpoint.error}
          </p>
        )}
        {data.approval && !data.approvalCurrent && (
          <p role="alert" className="text-sm text-destructive">
            The document or signing policy changed. Its previous approval is no longer current.
          </p>
        )}
        {canEdit && data.checkpointConfigured && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setAuditError(null);
                try {
                  const result = await verifyAudit({ agreementId });
                  setAuditResult(
                    result.status === "anchored"
                      ? "The audit history matches its protected checkpoint."
                      : result.status === "anchored_prefix"
                        ? `Protected through event ${result.anchoredSequence}; newer events still need anchoring.`
                        : result.status === "rollback_or_tampering_detected"
                          ? "Verification detected rollback or changed history. Contact the administrator."
                          : `Audit verification: ${statusLabel(result.status)}.`,
                  );
                } catch (err) {
                  setAuditError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Verify protected audit
            </Button>
            {data.checkpoint &&
              data.checkpoint.status !== "stored" &&
              data.checkpoint.status !== "running" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || data.checkpoint.attempts >= 5}
                  onClick={async () => {
                    setBusy(true);
                    setAuditError(null);
                    try {
                      await retryCheckpoint({ checkpointId: data.checkpoint!.id });
                    } catch (err) {
                      setAuditError(errorMessage(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Retry checkpoint
                </Button>
              )}
          </div>
        )}
        {auditResult && (
          <p role="status" className="text-sm">
            {auditResult}
          </p>
        )}
        <FormError message={auditError} />
      </Card>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-medium">
          <History className="h-4 w-4" />
          Activity
        </h2>
        <ol className="mt-4 space-y-4">
          {history.map((event) => (
            <li key={event._id} className="border-l-2 pl-3 text-sm">
              <p className="capitalize">{statusLabel(event.eventType)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Revision {event.revision} · {new Date(event.occurredAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
        {status === "CanLoadMore" && (
          <Button className="mt-4" size="sm" variant="outline" onClick={() => loadMore(10)}>
            Earlier activity
          </Button>
        )}
      </Card>
    </div>
  );
}

function DraftEditor({
  tenantId,
  initial,
  onSaved,
  onCancel,
  disabledBySecurity,
}: {
  tenantId: Id<"tenants">;
  initial?: AgreementData;
  onSaved: (id: Id<"signingAgreements">) => void;
  onCancel: () => void;
  disabledBySecurity: boolean;
}) {
  const [draft, setDraft] = useState<SigningDraft>(() =>
    initial ? toDraft(initial) : emptyDraft(),
  );
  const [expectedRevision, setExpectedRevision] = useState(initial?.agreement.revision ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const properties = useQuery(api.properties.list, { tenantId });
  const leases = useQuery(api.leases.list, { tenantId });
  // Keep an idempotency key across uncertain retries of the same content.
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const create = useMutation(api.signing.createDraft);
  const update = useMutation(api.signing.updateDraft);
  const stale = initial && initial.agreement.revision !== expectedRevision;
  const disabled =
    disabledBySecurity ||
    busy ||
    Boolean(stale) ||
    Boolean(initial && initial.agreement.status !== "draft");
  const changeParticipant = (key: string, patch: Partial<SigningDraft["participants"][number]>) =>
    setDraft({
      ...draft,
      participants: draft.participants.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    });
  return (
    <Card className="p-5">
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (inFlight.current || disabled || step !== 2) return;
          inFlight.current = true;
          setError(null);
          setBusy(true);
          const fingerprint = JSON.stringify({ draft, expectedRevision });
          const request =
            pending.current?.fingerprint === fingerprint ? pending.current.id : requestId();
          pending.current = { fingerprint, id: request };
          try {
            const result = initial
              ? await update({
                  agreementId: initial.agreement._id,
                  expectedRevision,
                  requestId: request,
                  draft,
                })
              : await create({ tenantId, requestId: request, draft });
            onSaved(result.agreementId);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 className="text-xl font-medium">
            {initial ? "Edit agreement draft" : "New agreement draft"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saving preserves a new revision. It does not send an invitation.
          </p>
          <ol className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Agreement creation steps">
            {["Agreement details", "Participants and order", "Review draft"].map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={`rounded-full border px-3 py-1 ${step === index ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
        </div>
        {stale && (
          <div role="alert" className="rounded-lg border border-amber-500/40 p-3 text-sm">
            <p>
              This draft changed while you were editing. Reload to review the latest version before
              saving. This replaces your unsaved edits.
            </p>
            <Button
              className="mt-2"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(toDraft(initial));
                setExpectedRevision(initial.agreement.revision);
                pending.current = null;
              }}
            >
              Reload latest version
            </Button>
          </div>
        )}
        {initial && initial.agreement.status !== "draft" && (
          <p role="alert" className="text-sm text-muted-foreground">
            This agreement is no longer an editable draft. Close to review its latest status.
          </p>
        )}
        <fieldset disabled={disabled} className="space-y-5">
          {disabledBySecurity && (
            <p role="alert" className="text-sm text-muted-foreground">
              Verify your signing authenticator above to save changes. Your unsaved draft is
              preserved.
            </p>
          )}
          {step === 0 && (
            <>
              <Field label="Agreement title" htmlFor="agreement-title">
                <Input
                  id="agreement-title"
                  required
                  maxLength={200}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
              <Field label="Property (optional)" htmlFor="agreement-property">
                <NativeSelect
                  id="agreement-property"
                  value={draft.propertyId ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      propertyId: e.target.value ? (e.target.value as Id<"properties">) : undefined,
                      leaseId: undefined,
                    })
                  }
                >
                  <option value="">No property association</option>
                  {properties?.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Existing lease (optional)" htmlFor="agreement-lease">
                <NativeSelect
                  id="agreement-lease"
                  value={draft.leaseId ?? ""}
                  disabled={!draft.propertyId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      leaseId: e.target.value ? (e.target.value as Id<"leases">) : undefined,
                    })
                  }
                >
                  <option value="">No lease association</option>
                  {leases
                    ?.filter((lease) => lease.propertyId === draft.propertyId)
                    .map((lease) => (
                      <option key={lease._id} value={lease._id}>
                        {lease.startDate} – {lease.endDate}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="Agreement type" htmlFor="agreement-type">
                <NativeSelect
                  id="agreement-type"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value as SigningCategory })
                  }
                >
                  {Object.entries(categories).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Draft notes"
                htmlFor="agreement-notes"
                hint="Preparation notes; these are not generated contract terms."
              >
                <Textarea
                  id="agreement-notes"
                  maxLength={10000}
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </Field>
              <Field
                label="Signature method"
                htmlFor="agreement-signature-method"
                hint="Accredited advanced signatures stay blocked until a provider is accepted."
              >
                <NativeSelect
                  id="agreement-signature-method"
                  value={draft.signatureMethod ?? "electronic"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      signatureMethod: e.target.value === "advanced" ? "advanced" : undefined,
                    })
                  }
                >
                  <option value="electronic">Electronic signature with platform seal</option>
                  <option value="advanced">Accredited advanced electronic signature</option>
                </NativeSelect>
              </Field>
            </>
          )}
          {step === 1 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Participants</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={draft.participants.length >= 20}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      participants: [
                        ...draft.participants,
                        {
                          key: requestId(),
                          name: "",
                          email: "",
                          role: "",
                          responsibility: "signer",
                          stage: 1,
                        },
                      ],
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add participant
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Participants in the same stage act in parallel. Later stages follow earlier stages.
                This records the intended order for preparation.
              </p>
              {draft.participants.map((p, index) => (
                <fieldset key={p.key} className="rounded-lg border p-3">
                  <legend className="px-1 text-xs">Participant {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Full name" htmlFor={`${p.key}-name`}>
                      <Input
                        id={`${p.key}-name`}
                        required
                        maxLength={160}
                        value={p.name}
                        onChange={(e) => changeParticipant(p.key, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Email" htmlFor={`${p.key}-email`}>
                      <Input
                        id={`${p.key}-email`}
                        type="email"
                        required
                        maxLength={254}
                        value={p.email}
                        onChange={(e) => changeParticipant(p.key, { email: e.target.value })}
                      />
                    </Field>
                    <Field label="Party role" htmlFor={`${p.key}-role`}>
                      <Input
                        id={`${p.key}-role`}
                        required
                        maxLength={100}
                        placeholder="Tenant, landlord, representative…"
                        value={p.role}
                        onChange={(e) => changeParticipant(p.key, { role: e.target.value })}
                      />
                    </Field>
                    <Field label="Responsibility" htmlFor={`${p.key}-responsibility`}>
                      <NativeSelect
                        id={`${p.key}-responsibility`}
                        value={p.responsibility}
                        onChange={(e) =>
                          changeParticipant(p.key, {
                            responsibility: e.target
                              .value as SigningDraft["participants"][number]["responsibility"],
                          })
                        }
                      >
                        {["signer", "approver", "viewer", "copy"].map((role) => (
                          <option key={role} value={role}>
                            {role === "copy"
                              ? "Copy recipient"
                              : role.charAt(0).toUpperCase() + role.slice(1)}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Stage" htmlFor={`${p.key}-stage`}>
                      <Input
                        id={`${p.key}-stage`}
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        required
                        value={p.stage}
                        onChange={(e) =>
                          changeParticipant(p.key, { stage: Number(e.target.value) })
                        }
                      />
                    </Field>
                    {p.responsibility === "signer" && (
                      <Field
                        label="Witness for"
                        htmlFor={`${p.key}-witnessFor`}
                        hint="Needs a witnessing approval in the signing policy."
                      >
                        <NativeSelect
                          id={`${p.key}-witnessFor`}
                          value={p.witnessFor ?? ""}
                          onChange={(e) =>
                            changeParticipant(p.key, { witnessFor: e.target.value || undefined })
                          }
                        >
                          <option value="">Not a witness</option>
                          {draft.participants
                            .filter(
                              (other) =>
                                other.key !== p.key &&
                                other.responsibility === "signer" &&
                                !other.witnessFor,
                            )
                            .map((other) => (
                              <option key={other.key} value={other.key}>
                                {other.name || "Unnamed signer"}
                              </option>
                            ))}
                        </NativeSelect>
                      </Field>
                    )}
                    <Field label="Notify by" htmlFor={`${p.key}-notifyVia`}>
                      <NativeSelect
                        id={`${p.key}-notifyVia`}
                        value={p.notifyVia ?? "email"}
                        onChange={(e) => {
                          const notifyVia = e.target.value as "email" | "sms" | "whatsapp";
                          changeParticipant(p.key, {
                            notifyVia: notifyVia === "email" ? undefined : notifyVia,
                            ...(notifyVia === "whatsapp"
                              ? {}
                              : { whatsappOptInReference: undefined }),
                          });
                        }}
                      >
                        <option value="email">Email</option>
                        <option value="sms">SMS (provider not yet accepted)</option>
                        <option value="whatsapp">WhatsApp (provider not yet accepted)</option>
                      </NativeSelect>
                    </Field>
                    <Field
                      label="Mobile number (optional)"
                      htmlFor={`${p.key}-phone`}
                      hint="International format, e.g. +27821234567."
                    >
                      <Input
                        id={`${p.key}-phone`}
                        type="tel"
                        maxLength={20}
                        value={p.phone ?? ""}
                        onChange={(e) =>
                          changeParticipant(p.key, { phone: e.target.value || undefined })
                        }
                      />
                    </Field>
                    {p.notifyVia === "whatsapp" && (
                      <Field
                        label="WhatsApp opt-in reference"
                        htmlFor={`${p.key}-optIn`}
                        hint="Where the participant's opt-in is recorded."
                      >
                        <Input
                          id={`${p.key}-optIn`}
                          maxLength={300}
                          value={p.whatsappOptInReference ?? ""}
                          onChange={(e) =>
                            changeParticipant(p.key, {
                              whatsappOptInReference: e.target.value || undefined,
                            })
                          }
                        />
                      </Field>
                    )}
                  </div>
                  <Button
                    className="mt-2"
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove participant ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        participants: draft.participants.filter((other) => other.key !== p.key),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </fieldset>
              ))}
            </section>
          )}
          {step === 2 && (
            <section className="space-y-3 text-sm">
              <h3 className="font-medium">Review before saving</h3>
              <p>
                {draft.title || "Untitled draft"} · {categories[draft.category]}
              </p>
              <p className="text-muted-foreground">
                Property:{" "}
                {draft.propertyId
                  ? (properties?.find((p) => p._id === draft.propertyId)?.name ??
                    "Selected property unavailable")
                  : "No property association"}
              </p>
              <p className="text-muted-foreground">
                Existing lease:{" "}
                {draft.leaseId
                  ? (() => {
                      const lease = leases?.find((l) => l._id === draft.leaseId);
                      return lease
                        ? `${lease.startDate} – ${lease.endDate}`
                        : "Selected lease unavailable";
                    })()
                  : "No lease association"}
              </p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {draft.notes || "No preparation notes."}
              </p>
              <ul className="divide-y rounded-md border">
                {draft.participants.map((p) => (
                  <li key={p.key} className="p-3">
                    <p>
                      {p.name} · {p.email}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.role} · {p.responsibility} · stage {p.stage}
                    </p>
                  </li>
                ))}
              </ul>
              {!draft.participants.some((p) => p.responsibility === "signer") && (
                <p className="text-amber-700">
                  This draft has no signers yet. Add them before preparing signing fields or
                  requesting approval.
                </p>
              )}
              <p className="text-muted-foreground">
                After saving: upload and validate the PDF and annexures, place signing fields,
                review every participant's preview, then request internal approval.
              </p>
            </section>
          )}
        </fieldset>
        <FormError message={error} />
        <div className="flex gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              Back
            </Button>
          )}
          {step < 2 && (
            <Button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                if (event.currentTarget.closest("form")?.reportValidity()) setStep(step + 1);
              }}
            >
              Next
            </Button>
          )}
          {step === 2 && (
            <Button type="submit" disabled={disabled}>
              {busy ? "Saving…" : "Save draft"}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Close
          </Button>
        </div>
      </form>
    </Card>
  );
}
