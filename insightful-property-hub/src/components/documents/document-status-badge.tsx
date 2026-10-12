import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CLIENT_DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  isProcessing,
  statusTone,
  type DocumentStatus,
} from "@/lib/documents";

const TONE_CLASSES = {
  default: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-success/40 bg-success/10 text-success",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

export function DocumentStatusBadge({
  status,
  audience = "staff",
}: {
  status: DocumentStatus;
  audience?: "staff" | "client";
}) {
  const label =
    audience === "client" ? CLIENT_DOCUMENT_STATUS_LABELS[status] : DOCUMENT_STATUS_LABELS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASSES[statusTone(status)],
      )}
    >
      {isProcessing(status) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {label}
    </span>
  );
}
