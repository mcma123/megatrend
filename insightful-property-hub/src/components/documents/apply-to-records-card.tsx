import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DraftInsightButton } from "@/components/insights/insight-editor-dialog";
import { NativeSelect } from "@/components/portfolio/form-fields";
import type { DocumentType } from "@/lib/documents";
import { describeLeaseStatus, errorMessage, formatDate, formatZAR } from "@/lib/portfolio";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Staff: link the document to a property, apply approved lease fields, or draft an insight. */
export function ApplyToRecordsCard({
  documentId,
  tenantId,
  propertyId,
  documentType,
  hasApprovedFields,
}: {
  documentId: Id<"documents">;
  tenantId: Id<"tenants">;
  propertyId?: Id<"properties">;
  documentType?: DocumentType;
  hasApprovedFields: boolean;
}) {
  const properties = useQuery(api.properties.list, { tenantId });
  const property = useQuery(api.properties.get, propertyId ? { propertyId } : "skip");
  const updateDetails = useMutation(api.documents.updateDetails);
  const applyToLease = useMutation(api.review.applyToLease);
  const [selectedLease, setSelectedLease] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLeaseDocument = documentType === "lease" || documentType === "addendum";
  const leases = property?.leases ?? [];
  const leaseChoice = selectedLease ?? leases[0]?._id ?? "new";

  useVoiceCommands("documents.detail", {
    "document.linkProperty": {
      run: async ({ property: next }) => {
        try {
          await updateDetails({
            documentId,
            propertyId: String(next) as Id<"properties">,
            documentType,
          });
        } catch (linkError) {
          throw new Error(errorMessage(linkError));
        }
        setSelectedLease(null);
        return "Linked to property.";
      },
      params: [
        {
          name: "property",
          label: "Property",
          type: "select",
          required: true,
          options: (properties ?? []).map((item) => ({ value: item._id, label: item.name })),
        },
      ],
      enabled: Boolean(properties?.length),
    },
    "document.applyToLease": {
      run: async ({ lease }) => {
        try {
          const result = await applyToLease({
            documentId,
            leaseId: lease === "new" ? undefined : (String(lease) as Id<"leases">),
          });
          return result.created
            ? "Lease created from the approved values."
            : "Lease updated with the approved values.";
        } catch (applyError) {
          throw new Error(errorMessage(applyError));
        }
      },
      params: [
        {
          name: "lease",
          label: "Lease",
          type: "select",
          required: true,
          options: [
            ...leases.map((item) => ({
              value: item._id,
              label: `${formatDate(item.startDate)} to ${formatDate(item.endDate)} · ${describeLeaseStatus(item)}`,
            })),
            { value: "new", label: "Create a new lease from this document" },
          ],
        },
      ],
      enabled: isLeaseDocument && Boolean(propertyId) && hasApprovedFields && !busy,
    },
  });

  const linkProperty = async (nextPropertyId: string) => {
    try {
      await updateDetails({
        documentId,
        propertyId: (nextPropertyId || undefined) as Id<"properties"> | undefined,
        documentType,
      });
      setSelectedLease(null);
      toast.success(nextPropertyId ? "Linked to property" : "Unlinked from property");
    } catch (linkError) {
      toast.error(errorMessage(linkError));
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const result = await applyToLease({
        documentId,
        leaseId: leaseChoice === "new" ? undefined : (leaseChoice as Id<"leases">),
      });
      toast.success(
        result.created
          ? "Lease created from the approved values"
          : "Lease updated with the approved values",
      );
    } catch (applyError) {
      toast.error(errorMessage(applyError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="surface-elevated mt-4 p-5">
      <h3 className="font-display text-lg">Use the approved values</h3>
      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium">Property</p>
          <NativeSelect
            value={propertyId ?? ""}
            onChange={(e) => void linkProperty(e.target.value)}
            aria-label="Linked property"
          >
            <option value="">Not linked</option>
            {properties?.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
          {isLeaseDocument && propertyId ? (
            <>
              <p className="pt-2 text-xs font-medium">Lease to update</p>
              <NativeSelect
                value={leaseChoice}
                onChange={(e) => setSelectedLease(e.target.value)}
                aria-label="Lease to update"
              >
                {leases.map((lease) => (
                  <option key={lease._id} value={lease._id}>
                    {formatDate(lease.startDate)} → {formatDate(lease.endDate)} ·{" "}
                    {formatZAR(lease.monthlyRental)} · {describeLeaseStatus(lease)}
                  </option>
                ))}
                <option value="new">Create a new lease from this document</option>
              </NativeSelect>
              <Button
                size="sm"
                className="mt-2"
                disabled={busy || !hasApprovedFields}
                onClick={() => void apply()}
              >
                {busy ? "Applying…" : "Apply approved fields to lease"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Only approved values are applied: dates, rental, escalation, notice, break and
                renewal terms, plus lettable area and landlord on the property.
              </p>
            </>
          ) : isLeaseDocument ? (
            <p className="text-xs text-muted-foreground">
              Link the property to update its lease record.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium">Client insight</p>
          <p className="text-xs text-muted-foreground">
            Draft a client-facing insight from the approved values with AI. You review and publish
            it from Insights.
          </p>
          {hasApprovedFields ? (
            <DraftInsightButton source={{ documentId }}>
              <Sparkles className="h-4 w-4" /> Draft insight with AI
            </DraftInsightButton>
          ) : (
            <p className="text-xs text-warning">Approve fields first.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
