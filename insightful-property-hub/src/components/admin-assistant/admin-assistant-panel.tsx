import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type UIMessagePart } from "ai";
import { useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react";
import { getAdminAssistantPageContext } from "@/components/admin-assistant/page-context";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL = "openai/gpt-4.1-mini";
const MODEL_STORAGE_KEY = "megatrend-assistant:selected-model";

type ModelOption = {
  id: string;
  name: string;
  description: string;
  contextLength: number | null;
  supportsTools: boolean;
  supportsReasoning: boolean;
};

type ModelsResponse = {
  models?: ModelOption[];
};

type AssistantPart = UIMessagePart<Record<string, never>, Record<string, { input: unknown; output: unknown }>>;
type AssistantMessage = UIMessage<unknown, Record<string, never>, Record<string, { input: unknown; output: unknown }>>;
type ToolLikePart = AssistantPart & {
  type: "dynamic-tool" | `tool-${string}`;
  state: string;
  toolName?: string;
  toolCallId: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function getUserMessageText(message: AssistantMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

function isToolPart(part: AssistantPart): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function getToolName(part: ToolLikePart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.replace(/^tool-/, "");
}

function formatJson(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatContextLength(value: number | null) {
  if (!value) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function ReasoningCard({ part }: { part: Extract<AssistantPart, { type: "reasoning" }> }) {
  const isStreaming = part.state === "streaming";

  return (
    <Collapsible defaultOpen={isStreaming}>
      <div className="rounded-2xl border border-border/80 bg-muted/40 p-3 shadow-sm">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <BrainCircuit className="h-4 w-4 text-primary" />
            Reasoning
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{part.text}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ToolCard({ part }: { part: ToolLikePart }) {
  const toolName = getToolName(part);
  const inputText = "input" in part ? formatJson(part.input) : null;
  const outputText = "output" in part ? formatJson(part.output) : null;
  const errorText = "errorText" in part ? part.errorText : null;
  const statusLabel = part.state.replace(/-/g, " ");
  const hasDetails = Boolean(inputText || outputText || errorText);

  return (
    <Collapsible defaultOpen={part.state !== "output-available"}>
      <div className="rounded-2xl border border-border/80 bg-background p-3 shadow-sm">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Wrench className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{toolName}</p>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{statusLabel}</p>
            </div>
          </div>
          {hasDetails ? <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" /> : null}
        </CollapsibleTrigger>
        {hasDetails ? (
          <CollapsibleContent className="space-y-3 pt-3">
            {inputText ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Input</p>
                <pre className="overflow-x-auto rounded-xl bg-muted/60 p-3 text-xs leading-5 text-foreground">{inputText}</pre>
              </div>
            ) : null}
            {outputText ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Output</p>
                <pre className="overflow-x-auto rounded-xl bg-muted/60 p-3 text-xs leading-5 text-foreground">{outputText}</pre>
              </div>
            ) : null}
            {errorText ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
                {errorText}
              </div>
            ) : null}
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function AssistantMessageView({ message }: { message: AssistantMessage }) {
  const visibleParts = message.parts.filter((part) => part.type !== "step-start");

  if (visibleParts.length === 0) {
    return null;
  }

  return (
    <div className="flex justify-start">
      <div className="flex w-full max-w-[92%] flex-col gap-3">
        {visibleParts.map((part, index) => {
          if (part.type === "text") {
            return (
              <div key={`${message.id}-text-${index}`} className="rounded-[28px] border border-border/80 bg-card px-4 py-3 text-sm text-foreground shadow-sm">
                <p className="whitespace-pre-wrap leading-6">{part.text}</p>
              </div>
            );
          }

          if (part.type === "reasoning") {
            return <ReasoningCard key={`${message.id}-reasoning-${index}`} part={part} />;
          }

          if (isToolPart(part)) {
            return <ToolCard key={`${message.id}-tool-${index}`} part={part} />;
          }

          if (part.type === "source-url") {
            return (
              <a
                key={`${message.id}-source-${index}`}
                href={part.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {part.title ?? part.url}
              </a>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

export function AdminAssistantPanel() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pageContext = getAdminAssistantPageContext(pathname);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { messages, sendMessage, status, stop, error } = useChat<AssistantMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const isBusy = status === "submitted" || status === "streaming";
  const selectedModelOption = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? null,
    [models, selectedModel],
  );
  const modelSupportsReasoning = selectedModel.includes("deepseek") || selectedModelOption?.supportsReasoning === true;

  useEffect(() => {
    const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel) {
      setSelectedModel(savedModel);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadModels = async () => {
      try {
        setIsModelsLoading(true);
        setModelsError(null);

        const response = await fetch("/api/models", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as ModelsResponse;
        const nextModels = payload.models ?? [];
        setModels(nextModels);

        if (!nextModels.some((model) => model.id === selectedModel)) {
          const fallbackModel = nextModels.find((model) => model.id === DEFAULT_MODEL)?.id ?? nextModels[0]?.id;
          if (fallbackModel) {
            setSelectedModel(fallbackModel);
          }
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setModelsError(loadError instanceof Error ? loadError.message : "Failed to load OpenRouter models.");
      } finally {
        if (!controller.signal.aborted) {
          setIsModelsLoading(false);
        }
      }
    };

    void loadModels();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const getRequestOptions = () => ({
    body: {
      requestContext: {
        selectedModel,
      },
      providerOptions: modelSupportsReasoning
        ? {
            openai: {
              include_reasoning: true,
            },
          }
        : undefined,
    },
  });

  const submitDraft = async () => {
    const text = draft.trim();
    if (!text || isBusy) {
      return;
    }

    setDraft("");
    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text }],
      },
      getRequestOptions(),
    );
  };

  const sendSuggestion = async (suggestion: string) => {
    if (isBusy) {
      return;
    }

    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: suggestion }],
      },
      getRequestOptions(),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Megatrend Assistant</h2>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {pageContext.title}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                  isBusy ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {isBusy ? "Thinking" : "Ready"}
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{pageContext.description}</p>
          </div>
        </div>
      </div>

      <div className="border-b border-border/70 px-5 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="max-w-full justify-between gap-2 rounded-full">
                <div className="flex min-w-0 items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="truncate text-left">{selectedModel}</span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[360px] p-0">
              <Command>
                <CommandInput placeholder="Search OpenRouter models..." />
                <CommandList>
                  <CommandEmpty>No models found.</CommandEmpty>
                  <CommandGroup>
                    {models.map((model) => (
                      <CommandItem
                        key={model.id}
                        value={`${model.id} ${model.name} ${model.description}`}
                        onSelect={() => {
                          setSelectedModel(model.id);
                          setIsModelPickerOpen(false);
                        }}
                        className="items-start gap-3 py-3"
                      >
                        <Check className={cn("mt-0.5 h-4 w-4", selectedModel === model.id ? "opacity-100" : "opacity-0")} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{model.id}</p>
                          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{model.description || model.name}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {model.contextLength ? <span>{formatContextLength(model.contextLength)} context</span> : null}
                            {model.supportsTools ? <span>tools</span> : null}
                            {model.supportsReasoning ? <span>reasoning</span> : null}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedModelOption?.supportsTools ? (
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Tools enabled</span>
          ) : null}
          {modelSupportsReasoning ? (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">Reasoning visible</span>
          ) : null}
          {isModelsLoading ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading models
            </span>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitDraft();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search the web, summarize a page, or ask a research question..."
              className="h-11 rounded-full border-border/80 bg-card pl-10 pr-4 text-sm shadow-sm"
            />
          </div>
          {isBusy ? (
            <Button type="button" variant="outline" onClick={() => stop()} className="rounded-full">
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : null}
          <Button type="submit" className="rounded-full" disabled={!draft.trim() || isBusy}>
            <ArrowUp className="h-4 w-4" />
            Ask
          </Button>
        </form>

        {modelsError ? <p className="mt-3 text-xs text-destructive">{modelsError}</p> : null}
      </div>

      <ScrollArea className="flex-1" viewportRef={viewportRef}>
        <div className="flex min-h-full flex-col gap-4 px-5 py-5">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-[28px] border border-border/80 bg-card px-4 py-4 shadow-sm">
                <p className="text-sm leading-6 text-foreground">
                  Ask for research, summaries, source-finding, or next-step recommendations. This panel is connected
                  directly to the `web-research-agent` in Mastra.
                </p>
              </div>
              <div className="grid gap-2">
                {pageContext.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendSuggestion(suggestion)}
                    className="rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => {
            if (message.role === "user") {
              const text = getUserMessageText(message);

              if (!text) {
                return null;
              }

              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[28px] bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
                    <p className="whitespace-pre-wrap leading-6">{text}</p>
                  </div>
                </div>
              );
            }

            return <AssistantMessageView key={message.id} message={message} />;
          })}

          {isBusy ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Researching...
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error.message}
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-background px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {pageContext.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => sendSuggestion(suggestion)}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}





