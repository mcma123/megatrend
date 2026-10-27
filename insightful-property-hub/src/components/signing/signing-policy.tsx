import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { SigningCategory } from "../../../../convex/lib/signing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/portfolio/form-fields";

type Policy = Doc<"signingPolicies"> | null;
const categories: [SigningCategory, string][] = [
  ["residential_lease", "Residential leases"],
  ["commercial_lease", "Commercial leases"],
  ["renewal", "Renewals"],
  ["general_contract", "General contracts"],
];
function initial(policy: Policy) {
  return {
    expectedRevision: policy?.revision ?? 0,
    legalReviewReference: policy?.legalReviewReference ?? "",
    privacyNoticeReference: policy?.privacyNoticeReference ?? "",
    retentionPolicyReference: policy?.retentionPolicyReference ?? "",
    consentVersion: policy?.consentVersion ?? "",
    allowedCategories: policy?.allowedCategories ?? ([] as SigningCategory[]),
    approvalRequired: policy?.approvalRequired ?? true,
    allowSelfApproval: policy?.allowSelfApproval ?? false,
    signerContact: policy?.signerContact ?? "",
    witnessingReference: policy?.witnessingReference ?? "",
    transientRetentionDays: policy?.transientRetentionDays ?? 90,
  };
}
export function SigningPolicy({
  tenantId,
  policy,
  canEdit,
}: {
  tenantId: Id<"tenants">;
  policy: Policy;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        Policy reference revision: {policy?.revision ?? "not recorded"}. Record only existing
        authorised reviews; saving cannot enable external signing.
      </p>
      {canEdit && !open && (
        <Button className="mt-2" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Record policy references
        </Button>
      )}
      {open && (
        <PolicyForm
          tenantId={tenantId}
          policy={policy}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
function PolicyForm({
  tenantId,
  policy,
  canEdit,
  onClose,
}: {
  tenantId: Id<"tenants">;
  policy: Policy;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => initial(policy));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const record = useMutation(api.signing.recordPolicy);
  const stale = form.expectedRevision !== (policy?.revision ?? 0);
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canEdit || stale || busy) return;
        setBusy(true);
        setError(null);
        try {
          await record({ tenantId, ...form });
          onClose();
        } catch (err) {
          setError(
            err instanceof ConvexError && typeof err.data === "string"
              ? err.data
              : "Policy references could not be saved",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {stale && (
        <div role="alert" className="text-xs">
          <p>
            The policy changed. Reload to replace your unsaved edits with its latest references.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setForm(initial(policy))}
          >
            Reload policy
          </Button>
        </div>
      )}
      {!canEdit && (
        <p role="alert" className="text-xs">
          Verify your signing authenticator to save these references.
        </p>
      )}
      <fieldset disabled={busy || stale || !canEdit} className="space-y-3">
        {(
          [
            ["legalReviewReference", "Legal review reference"],
            ["privacyNoticeReference", "Privacy notice reference"],
            ["retentionPolicyReference", "Retention and legal-hold policy reference"],
            ["consentVersion", "Approved electronic-consent version"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`policy-${key}`}>
            <Input
              id={`policy-${key}`}
              dictation={false}
              maxLength={key === "consentVersion" ? 100 : 500}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="Contact details shown to signers (optional)" htmlFor="policy-signerContact">
          <Input
            id="policy-signerContact"
            dictation={false}
            maxLength={300}
            value={form.signerContact}
            onChange={(e) => setForm({ ...form, signerContact: e.target.value })}
          />
        </Field>
        <Field
          label="Legal approval reference for witnessed signing (optional)"
          htmlFor="policy-witnessingReference"
        >
          <Input
            id="policy-witnessingReference"
            dictation={false}
            maxLength={500}
            value={form.witnessingReference}
            onChange={(e) => setForm({ ...form, witnessingReference: e.target.value })}
          />
        </Field>
        <Field
          label="Delete unfinished signer drafts and unused marks after (days, 30–3650)"
          htmlFor="policy-transientRetentionDays"
        >
          <Input
            id="policy-transientRetentionDays"
            type="number"
            min={30}
            max={3650}
            value={form.transientRetentionDays}
            onChange={(e) =>
              setForm({ ...form, transientRetentionDays: Number(e.target.value) || 90 })
            }
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium">Categories covered by that review</legend>
          {categories.map(([key, label]) => (
            <label key={key} className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.allowedCategories.includes(key)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    allowedCategories: e.target.checked
                      ? [...form.allowedCategories, key]
                      : form.allowedCategories.filter((c) => c !== key),
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.approvalRequired}
            onChange={(e) => setForm({ ...form, approvalRequired: e.target.checked })}
          />
          Internal approval required
        </label>
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.allowSelfApproval}
            onChange={(e) => setForm({ ...form, allowSelfApproval: e.target.checked })}
          />
          Policy explicitly permits the preparing administrator to approve their own document
        </label>
      </fieldset>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || stale || !canEdit}>
          Save references
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}
