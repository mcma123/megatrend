import { AdminAssistantPanel } from "@/components/admin-assistant/admin-assistant-panel";
import { useAdminAssistant } from "@/components/admin-assistant/admin-assistant-context";

export function AdminAssistantSheet() {
  const { open } = useAdminAssistant();

  return (
    <aside
      className={`shrink-0 overflow-hidden border-l border-border bg-background transition-[width,opacity] duration-300 ease-out ${
        open ? "w-full opacity-100 md:w-[440px] xl:w-[480px]" : "w-0 opacity-0"
      }`}
      aria-hidden={!open}
    >
      {open ? (
        <div className="flex h-full min-h-screen min-w-[320px] flex-col md:min-w-[440px] xl:min-w-[480px]">
          <AdminAssistantPanel />
        </div>
      ) : null}
    </aside>
  );
}
