import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { appendAuditEvent } from "./audit";
import { isoDateFromNow, upsertAutoAction } from "./autoActions";
import { isAutomationEnabled, recordRun } from "./automations";
import { notify, staffRecipients } from "./notifications";
import { readCurrentFields } from "./documentFields";

// Invoices and utility statements are recorded from APPROVED extracted fields when a document's
// review is completed. Each new invoice is compared with a rolling baseline of up to six earlier
// invoices from the same supplier for the same client and property; spikes and possible duplicates
// become anomalies with a staff investigation task and a draft insight.

const BASELINE_WINDOW = 6;
const MIN_BASELINE_SAMPLES = 3;

export function supplierKey(supplier: string) {
  return supplier
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|cc|soc|municipality|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 60);
}

/** Severity for an increase over baseline (delta as a fraction), or null when not anomalous. */
export function spikeSeverity(
  delta: number,
): Doc<"anomalies">["severity"] | null {
  if (delta >= 0.5) return "critical";
  if (delta >= 0.3) return "high";
  if (delta >= 0.15) return "medium";
  return null;
}

function numberOf(value: string | undefined) {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

export type RecordInvoiceResult =
  | { recorded: false; reason: string }
  | { recorded: true; invoiceId: Id<"invoices">; anomalies: number };

export async function recordInvoiceFromDocument(
  ctx: MutationCtx,
  document: Doc<"documents">,
  actorId: Id<"users">,
): Promise<RecordInvoiceResult> {
  const type = document.documentType ?? document.declaredType;
  if (type !== "invoice" && type !== "utility_statement") {
    return { recorded: false, reason: "not an invoice" };
  }
  const fields = await readCurrentFields(ctx, document);
  const approved = new Map(
    fields
      .filter((field) => field.state === "approved")
      .map((field) => [field.key, field.value]),
  );

  const supplier = approved.get("supplier_name");
  const amount = numberOf(
    approved.get("total_amount") ??
      approved.get("amount_due") ??
      approved.get("amount_excl_vat"),
  );
  const periodDate =
    approved.get("invoice_date") ??
    approved.get("statement_date") ??
    approved.get("due_date") ??
    new Date(document.createdAt).toISOString().slice(0, 10);
  if (!supplier || amount === undefined) {
    return {
      recorded: false,
      reason: "approve the supplier and amount to record this invoice",
    };
  }

  const now = Date.now();
  const key = supplierKey(supplier);
  const kind = type;
  const invoiceNumber = approved.get("invoice_number");

  // Baseline from earlier invoices in the same group (excluding this document).
  const sameSupplier = await ctx.db
    .query("invoices")
    .withIndex("by_tenantId_and_supplierKey", (q) =>
      q.eq("tenantId", document.tenantId).eq("supplierKey", key),
    )
    .take(200);
  const group = sameSupplier.filter(
    (invoice) =>
      invoice.documentId !== document._id &&
      invoice.kind === kind &&
      invoice.propertyId === document.propertyId,
  );
  const earlier = group
    .filter((invoice) => invoice.periodDate < periodDate)
    .sort((a, b) => b.periodDate.localeCompare(a.periodDate))
    .slice(0, BASELINE_WINDOW);
  const baseline =
    earlier.length >= MIN_BASELINE_SAMPLES
      ? earlier.reduce((total, invoice) => total + invoice.amount, 0) /
        earlier.length
      : undefined;

  const values = {
    tenantId: document.tenantId,
    documentId: document._id,
    propertyId: document.propertyId,
    kind,
    supplier,
    supplierKey: key,
    invoiceNumber,
    accountNumber: approved.get("account_number"),
    periodLabel: approved.get("billing_period"),
    periodDate,
    amount,
    vatAmount: numberOf(approved.get("vat_amount")),
    dueDate: approved.get("due_date"),
    consumption: approved.get("consumption"),
    baseline,
    baselineSampleSize: earlier.length,
    updatedAt: now,
  };

  const existing = (
    await ctx.db
      .query("invoices")
      .withIndex("by_documentId", (q) => q.eq("documentId", document._id))
      .take(1)
  )[0];
  let invoiceId: Id<"invoices">;
  if (existing) {
    invoiceId = existing._id;
    await ctx.db.patch(existing._id, values);
    // Re-reviewed document: earlier open anomalies are replaced by a fresh evaluation.
    const previous = await ctx.db
      .query("anomalies")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", existing._id))
      .take(20);
    for (const anomaly of previous) {
      if (anomaly.status === "open" || anomaly.status === "investigating") {
        await ctx.db.patch(anomaly._id, {
          status: "dismissed",
          note: "Superseded by a new review",
          updatedAt: now,
        });
      }
    }
  } else {
    invoiceId = await ctx.db.insert("invoices", { ...values, createdAt: now });
  }

  const checkEnabled = await isAutomationEnabled(ctx, "invoice_anomaly_check");
  const findings: Array<{
    kind: Doc<"anomalies">["kind"];
    severity: Doc<"anomalies">["severity"];
    delta?: number;
    cause: string;
  }> = [];

  if (checkEnabled && baseline !== undefined && baseline > 0) {
    const delta = (amount - baseline) / baseline;
    const severity = spikeSeverity(delta);
    if (severity) {
      findings.push({
        kind: "cost_spike",
        severity,
        delta,
        cause: `${ZAR.format(amount)} is ${Math.round(delta * 100)}% above the ${earlier.length}-period average of ${ZAR.format(baseline)} for ${supplier}.`,
      });
    }
  }
  const duplicate = group.find(
    (invoice) =>
      (invoiceNumber && invoice.invoiceNumber === invoiceNumber) ||
      (invoice.periodDate === periodDate &&
        Math.abs(invoice.amount - amount) < 0.5),
  );
  if (checkEnabled && duplicate) {
    findings.push({
      kind: "possible_duplicate",
      severity: "high",
      cause:
        invoiceNumber && duplicate.invoiceNumber === invoiceNumber
          ? `Invoice number ${invoiceNumber} from ${supplier} was already recorded.`
          : `Another ${supplier} invoice for ${ZAR.format(amount)} dated ${periodDate} was already recorded.`,
    });
  }

  for (const finding of findings) {
    const anomalyId = await ctx.db.insert("anomalies", {
      tenantId: document.tenantId,
      invoiceId,
      documentId: document._id,
      propertyId: document.propertyId,
      kind: finding.kind,
      supplier,
      amount,
      baseline,
      delta: finding.delta,
      severity: finding.severity,
      cause: finding.cause,
      status: "open",
      sharedWithClient: false,
      createdAt: now,
      updatedAt: now,
    });

    const title =
      finding.kind === "cost_spike"
        ? `Investigate cost spike: ${supplier}`
        : `Check possible duplicate: ${supplier}`;
    const { actionId } = await upsertAutoAction(ctx, {
      tenantId: document.tenantId,
      autoKey: `anomaly:${anomalyId}`,
      title,
      description: finding.cause,
      propertyId: document.propertyId,
      documentId: document._id,
      status: "open",
      priority: finding.severity === "critical" ? "critical" : "high",
      visibleToClient: false,
      dueDate: isoDateFromNow(3),
    });

    // Draft insight for staff to review; never published automatically.
    const insightId = await ctx.db.insert("insights", {
      tenantId: document.tenantId,
      propertyId: document.propertyId,
      documentIds: [document._id],
      title:
        finding.kind === "cost_spike"
          ? `${supplier} charges are ${Math.round((finding.delta ?? 0) * 100)}% above normal`
          : `Possible duplicate ${supplier} invoice`,
      body: `${finding.cause} We are checking the cause with the supplier and will confirm whether a correction or refund is due.`,
      recommendedAction:
        finding.kind === "cost_spike"
          ? "Hold payment of the excess until Cyphersoft confirms the charge."
          : "Don't pay this invoice twice; wait for Cyphersoft to confirm.",
      category: "cost",
      priority:
        finding.severity === "critical"
          ? "critical"
          : finding.severity === "medium"
            ? "medium"
            : "high",
      status: "draft",
      draftedBy: "system",
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(anomalyId, { actionId, insightId });

    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "anomaly.detected",
      actorType: "system",
      targetType: "anomaly",
      targetId: anomalyId,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        kind: finding.kind,
        severity: finding.severity,
        amount,
        baseline,
      }),
    });
    await notify(ctx, {
      recipients: await staffRecipients(ctx, document.tenantId),
      tenantId: document.tenantId,
      kind: "anomaly.detected",
      title: `${finding.severity === "critical" ? "Critical" : "New"} anomaly: ${supplier}`,
      body: finding.cause,
      link: "/invoices",
    });
  }

  if (checkEnabled) {
    await recordRun(ctx, {
      key: "invoice_anomaly_check",
      mode: "event",
      startedAt: now,
      triggeredBy: actorId,
      summary: findings.length
        ? `${findings.length} anomal${findings.length === 1 ? "y" : "ies"} found for ${supplier} (${ZAR.format(amount)}).`
        : `${supplier} ${ZAR.format(amount)} checked${baseline !== undefined ? ` against a baseline of ${ZAR.format(baseline)}` : " (baseline needs 3 earlier invoices)"}.`,
      stats: {
        invoicesChecked: 1,
        anomaliesFound: findings.length,
        baselineSamples: earlier.length,
      },
      items: findings.map((finding) => ({
        tenantId: document.tenantId,
        label: `${finding.kind} · ${finding.severity}`,
        detail: finding.cause,
      })),
    });
  }

  await appendAuditEvent(ctx, {
    tenantId: document.tenantId,
    eventType: existing ? "invoice.updated" : "invoice.recorded",
    actorType: "staff_user",
    actorId,
    targetType: "invoice",
    targetId: invoiceId,
    correlationId: `document:${document._id}`,
    sourceSystem: "convex",
    occurredAt: now,
    payloadAfter: JSON.stringify({
      supplier,
      amount,
      periodDate,
      baseline,
      samples: earlier.length,
    }),
  });

  return { recorded: true, invoiceId, anomalies: findings.length };
}
