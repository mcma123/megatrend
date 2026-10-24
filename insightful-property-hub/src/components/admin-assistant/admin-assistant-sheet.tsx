import { lazy, Suspense, useEffect, useState } from "react";
import { useAdminAssistant } from "@/components/admin-assistant/admin-assistant-context";

const AssistantWorkspace = lazy(() => import("./assistant-workspace"));

export function AdminAssistantSheet() {
  const { expanded, open } = useAdminAssistant();
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  return (
    <aside
      className={`sticky top-14 h-[calc(100svh-3.5rem)] shrink-0 self-start overflow-hidden border-l border-border bg-background transition-[width,opacity] duration-300 ease-out ${
        open
          ? expanded
            ? "w-full opacity-100"
            : "w-full opacity-100 md:w-[440px] xl:w-[480px]"
          : "w-0 opacity-0"
      }`}
      aria-hidden={!open}
    >
      {hasOpened || open ? (
        <div
          className={`flex h-full min-h-0 flex-col ${
            expanded ? "min-w-0" : "min-w-[320px] md:min-w-[440px] xl:min-w-[480px]"
          }`}
        >
          <Suspense
            fallback={
              <p role="status" className="p-5 text-sm text-muted-foreground">
                Opening the assistant…
              </p>
            }
          >
            <AssistantWorkspace open={open} />
          </Suspense>
        </div>
      ) : null}
    </aside>
  );
}
