import type { ReactNode } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useDocumentViewer } from "@/lib/document-viewer-context";

/** A file link always opens the original/preview in the current application. */
export function DocumentLink({
  documentId,
  children,
  className,
}: {
  documentId: string;
  children: ReactNode;
  className?: string;
}) {
  const open = useDocumentViewer();
  return (
    <button
      type="button"
      className={
        className ??
        "inline-flex items-center gap-1 text-left text-sm font-medium hover:text-primary"
      }
      onClick={() => open(documentId as Id<"documents">)}
    >
      {children}
    </button>
  );
}
