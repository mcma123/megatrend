import { AdminAssistantPanel } from "./admin-assistant-panel";
import { AssistantCopilotProvider } from "./copilot-provider";

/** Keep the connection and presentation handlers alive after the first open. */
export default function AssistantWorkspace({ open }: { open: boolean }) {
  return (
    <AssistantCopilotProvider>{open ? <AdminAssistantPanel /> : null}</AssistantCopilotProvider>
  );
}
