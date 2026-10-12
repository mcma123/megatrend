import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type ReviewField = Doc<"extractedFields">;

const STATE_LABELS: Record<ReviewField["state"], string> = {
  detected: "Pending",
  low_confidence_review: "Check",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
};

const STATE_CLASSES: Record<ReviewField["state"], string> = {
  detected: "text-muted-foreground",
  low_confidence_review: "text-warning",
  approved: "text-success",
  rejected: "text-destructive",
  superseded: "text-muted-foreground",
};

/**
 * Staff review of extracted fields: approve, correct-and-approve, or reject each value; bulk
 * approve high-confidence ones; complete the review once every field has a decision.
 */
export function FieldReviewTable({
  documentId,
  fields,
  canReview,
  reviewOpen,
}: {
  documentId: Id<"documents">;
  fields: ReviewField[];
  canReview: boolean;
  reviewOpen: boolean;
}) {
  const approveField = useMutation(api.review.approveField);
  const rejectField = useMutation(api.review.rejectField);
  const approveHighConfidence = useMutation(api.review.approveHighConfidence);
  const completeReview = useMutation(api.review.completeReview);
  const [editing, setEditing] = useState<{ id: Id<"extractedFields">; value: string } | null>(null);
  const pending = fields.filter(
    (field) => field.state === "detected" || field.state === "low_confidence_review",
  );
  const highConfidencePending = fields.filter((field) => field.state === "detected").length;

  const run = async (task: () => Promise<unknown>, success?: string) => {
    try {
      await task();
      if (success) toast.success(success);
    } catch (taskError) {
      toast.error(errorMessage(taskError));
    }
  };

  return (
    <div className="mt-4">
      {canReview && reviewOpen ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={highConfidencePending === 0}
            onClick={() =>
              void run(
                () => approveHighConfidence({ documentId }),
                "High-confidence fields approved",
              )
            }
          >
            <Check className="h-3.5 w-3.5" /> Approve {highConfidencePending} high-confidence
          </Button>
          <Button
            size="sm"
            disabled={pending.length > 0}
            onClick={() =>
              void run(
                () => completeReview({ documentId }),
                "Review complete. The client now sees this document as reviewed.",
              )
            }
          >
            Complete review
          </Button>
          <span className="text-xs text-muted-foreground">
            {pending.length > 0
              ? `${pending.length} field${pending.length === 1 ? "" : "s"} still need a decision. Low-confidence values are never approved automatically.`
              : "Every field has a decision."}
          </span>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-2 pr-3">Field</th>
              <th className="py-2 pr-3">Value</th>
              <th className="py-2 pr-3 text-right">Confidence</th>
              <th className="py-2 pr-3">Evidence</th>
              <th className="py-2 text-right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const isEditing = editing?.id === field._id;
              const isPending =
                field.state === "detected" || field.state === "low_confidence_review";
              return (
                <tr
                  key={field._id}
                  className={cn(
                    "border-b border-border/50 align-top",
                    field.state === "rejected" && "opacity-60",
                  )}
                >
                  <td className="py-2 pr-3 text-muted-foreground">{field.label}</td>
                  <td className="py-2 pr-3 font-medium">
                    {isEditing ? (
                      <Input
                        autoFocus
                        value={editing.value}
                        onChange={(e) => setEditing({ id: field._id, value: e.target.value })}
                        className="h-8"
                        placeholder={field.kind === "date" ? "YYYY-MM-DD" : undefined}
                        aria-label={`Corrected ${field.label}`}
                      />
                    ) : (
                      <>
                        <span className={field.state === "rejected" ? "line-through" : undefined}>
                          {field.value}
                        </span>
                        {field.originalValue ? (
                          <div className="text-[11px] font-normal text-muted-foreground">
                            extracted: {field.originalValue}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs",
                        field.confidence < 0.9 ? "text-warning" : "text-success",
                      )}
                    >
                      {Math.round(field.confidence * 100)}%
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs italic text-muted-foreground">
                    {field.evidence ? `“${field.evidence}”` : "—"}
                    {field.page ? ` (p. ${field.page})` : ""}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(async () => {
                              await approveField({ fieldId: field._id, value: editing.value });
                              setEditing(null);
                            }, "Corrected value approved")
                          }
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : isPending && canReview ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Approve ${field.label}`}
                          onClick={() => void run(() => approveField({ fieldId: field._id }))}
                        >
                          <Check className="h-4 w-4 text-success" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Correct ${field.label}`}
                          onClick={() => setEditing({ id: field._id, value: field.value })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Reject ${field.label}`}
                          onClick={() => void run(() => rejectField({ fieldId: field._id }))}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ) : (
                      <span className={cn("text-xs", STATE_CLASSES[field.state])}>
                        {STATE_LABELS[field.state]}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
