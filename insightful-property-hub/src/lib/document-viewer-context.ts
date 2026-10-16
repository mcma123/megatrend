import { createContext, useContext } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

export const DocumentViewerContext = createContext<((id: Id<"documents">) => void) | null>(null);

export function useDocumentViewer() {
  const open = useContext(DocumentViewerContext);
  if (!open) throw new Error("Document viewer must be inside DocumentViewerProvider");
  return open;
}
