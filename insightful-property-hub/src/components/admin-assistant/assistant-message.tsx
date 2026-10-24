import { useRenderToolCall } from "@copilotkit/react-core/v2/headless";
import type { Message } from "@ag-ui/core";
import { AssistantMarkdown } from "./rich-output";
import { record } from "./rich-output-data";

function contentText(message: Message): string {
  const content = record(message).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (typeof record(part).text === "string" ? record(part).text : ""))
      .join("\n");
  return "";
}

export function AssistantMessageView({
  message,
  messages,
  showReasoning,
}: {
  message: Message;
  messages: Message[];
  showReasoning: boolean;
}) {
  const renderToolCall = useRenderToolCall();
  const content = contentText(message);
  if (message.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[28px] bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
          {content}
        </div>
      </div>
    );
  if (message.role === "tool" || message.role === "system" || message.role === "developer")
    return null;
  if (message.role === "reasoning")
    return showReasoning ? (
      <details className="rounded-2xl border bg-muted/40 p-3 text-xs">
        <summary className="cursor-pointer font-medium">Reasoning</summary>
        <p className="whitespace-pre-wrap pt-3 leading-6">{content}</p>
      </details>
    ) : null;
  if (message.role !== "assistant") return null;
  if (!content && !message.toolCalls?.length) return null;
  return (
    <div className="flex min-w-0 justify-start">
      <div className="flex w-full min-w-0 max-w-full flex-col gap-3">
        {content ? (
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
            <AssistantMarkdown>{content}</AssistantMarkdown>
          </div>
        ) : null}
        {message.toolCalls?.map((toolCall) => {
          const toolMessage = messages.find(
            (item) => item.role === "tool" && item.toolCallId === toolCall.id,
          );
          return (
            <div key={toolCall.id} className="min-w-0">
              {renderToolCall({
                toolCall,
                toolMessage: toolMessage?.role === "tool" ? toolMessage : undefined,
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
