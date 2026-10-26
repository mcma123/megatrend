import { useEffect, useMemo, useRef, useState } from "react";
import { useAssistantChat } from "./use-assistant-chat";
import { AssistantMessageView } from "./assistant-message";
import { RichOutputContext } from "./assistant-runtime-context";
import { GuidedSearchCard, ShortlistTray } from "./assistant-interactions";
import { ResearchProgress } from "./advanced-interactions";
import { researchSteps } from "./advanced-interaction-data";
import { ChartFailureNotice } from "./assistant-chart";
import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2/headless";
import { useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useAdminAssistant } from "@/components/admin-assistant/admin-assistant-context";
import { getAdminAssistantPageContext } from "@/components/admin-assistant/page-context";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_AGENT = "web-research-agent";
const MODEL_STORAGE_KEY = "megatrend-assistant:selected-model";
const AGENT_STORAGE_KEY = "megatrend-assistant:selected-agent";
const SHOW_REASONING_STORAGE_KEY = "megatrend-assistant:show-reasoning";
const SHOW_IMAGES_STORAGE_KEY = "megatrend-assistant:show-images";

type ModelOption = {
  id: string;
  name: string;
  description: string;
  contextLength: number | null;
  supportsTools: boolean;
  supportsReasoning: boolean;
};

type AgentOption = {
  id: string;
  name: string;
  description: string;
  placeholder: string;
  intro: string;
  suggestions: string[];
};

type ModelsResponse = {
  models?: ModelOption[];
};

const AGENT_OPTIONS: AgentOption[] = [
  {
    id: "web-research-agent",
    name: "Web Research Agent",
    description: "Search the web, scrape sources, and summarize current information.",
    placeholder: "Search the web, summarize a page, or ask a research question...",
    intro:
      "Ask for research, summaries, source-finding, or next-step recommendations. This panel is connected directly to the `web-research-agent` in Mastra.",
    suggestions: [
      "Find recent sources on this topic",
      "Summarize the most relevant findings",
      "What should I investigate next?",
    ],
  },
  {
    id: "okf-agent",
    name: "OKF Agent",
    description: "Read and search documents from the OKF knowledge bucket.",
    placeholder: "Ask about a parsed document, transcript, resume, or OKF bundle...",
    intro:
      "Ask about documents stored in the OKF bucket. This panel is connected directly to the `okf-agent` in Mastra and can search bundle markdown, fetch bundle files, and inspect exact OKF documents.",
    suggestions: [
      "What OKF bundles are available?",
      "Search the OKF documents for transcript details",
      "Summarize the contents of a specific bundle",
    ],
  },
  {
    id: "facebook-marketplace-agent",
    name: "Facebook Marketplace Agent",
    description: "Use the Marketplace tools for search, listing review, and drafting.",
    placeholder: "Search Marketplace, inspect a listing, or draft a listing description...",
    intro:
      "Use Marketplace-specific tools through the `facebook-marketplace-agent` in Mastra. This is best for listing research, listing detail lookups, and drafting Marketplace copy.",
    suggestions: [
      "Check if the Marketplace tools are configured",
      "Search Marketplace for a specific item",
      "Draft a Marketplace listing from my notes",
    ],
  },
];

function formatContextLength(value: number | null) {
  if (!value) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function AdminAssistantPanel() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { close, expanded, toggleExpanded, pendingPrompt, clearPendingPrompt } =
    useAdminAssistant();
  const pageContext = getAdminAssistantPageContext(pathname);
  const [draft, setDraft] = useState("");
  const [showGuidedSearch, setShowGuidedSearch] = useState(false);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [selectedAgent, setSelectedAgent] = useState(DEFAULT_AGENT);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const hasScrolledRef = useRef(false);
  const { messages, sendMessage, status, stop, error, isReady } = useAssistantChat(selectedAgent);
  const isBusy = status === "streaming";
  const isAwaitingChoice = isBusy && researchSteps(messages).some((step) => step.waiting);
  const selectedModelOption = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? null,
    [models, selectedModel],
  );
  const selectedAgentOption = useMemo(
    () => AGENT_OPTIONS.find((agent) => agent.id === selectedAgent) ?? AGENT_OPTIONS[0],
    [selectedAgent],
  );
  const activeSuggestions =
    selectedAgent === "web-research-agent"
      ? pageContext.suggestions
      : selectedAgentOption.suggestions;
  const modelSupportsReasoning =
    selectedModel.includes("deepseek") || selectedModelOption?.supportsReasoning === true;

  useEffect(() => {
    const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel) {
      setSelectedModel(savedModel);
    }

    setShowReasoning(window.localStorage.getItem(SHOW_REASONING_STORAGE_KEY) === "true");
    setShowImages(window.localStorage.getItem(SHOW_IMAGES_STORAGE_KEY) === "true");

    const savedAgent = window.localStorage.getItem(AGENT_STORAGE_KEY);
    if (savedAgent && AGENT_OPTIONS.some((agent) => agent.id === savedAgent)) {
      setSelectedAgent(savedAgent);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    window.localStorage.setItem(AGENT_STORAGE_KEY, selectedAgent);
  }, [selectedAgent]);

  const toggleShowImages = () => {
    setShowImages((current) => {
      const next = !current;
      window.localStorage.setItem(SHOW_IMAGES_STORAGE_KEY, String(next));
      return next;
    });
  };

  const toggleShowReasoning = () => {
    setShowReasoning((current) => {
      const next = !current;
      window.localStorage.setItem(SHOW_REASONING_STORAGE_KEY, String(next));
      return next;
    });
  };

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

        setSelectedModel((currentModel) => {
          if (nextModels.some((model) => model.id === currentModel)) {
            return currentModel;
          }

          return (
            nextModels.find((model) => model.id === DEFAULT_MODEL)?.id ??
            nextModels[0]?.id ??
            currentModel
          );
        });
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setModelsError(
          loadError instanceof Error ? loadError.message : "Failed to load OpenRouter models.",
        );
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

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: hasScrolledRef.current ? "smooth" : "auto",
    });
    hasScrolledRef.current = true;
  }, [messages, status]);

  useEffect(() => {
    const textarea = draftRef.current;
    if (!textarea) {
      return;
    }

    // Grow with the draft up to the max-h-40 cap, then scroll inside the box.
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  // Another page (e.g. Search) asked to open the assistant with an agent and a question.
  useEffect(() => {
    if (!pendingPrompt || isBusy) return;
    if (AGENT_OPTIONS.some((agent) => agent.id === pendingPrompt.agentId)) {
      setSelectedAgent(pendingPrompt.agentId);
    }
    setDraft(pendingPrompt.text);
    clearPendingPrompt();
  }, [pendingPrompt, clearPendingPrompt, isBusy]);

  const sendSuggestion = async (text: string) => {
    if (isReady && !isBusy) await sendMessage(text);
  };
  const submitDraft = async () => {
    const text = draft.trim();
    if (!text || isBusy || !isReady) return;
    setDraft("");
    await sendMessage(text);
  };

  return (
    <CopilotChatConfigurationProvider agentId={selectedAgent}>
      <RichOutputContext.Provider
        value={{
          agentId: selectedAgent,
          followUp: (prompt) => {
            void sendSuggestion(prompt);
          },
          busy: isBusy || !isReady,
          showReasoning,
        }}
      >
        <div className="@container/assistant flex h-full min-h-0 flex-col bg-background">
          <div className="shrink-0 border-b border-border px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Cyphersoft Assistant</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {pageContext.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <div
                      className={cn(
                        "rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                        isBusy ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isAwaitingChoice
                        ? "Your choice"
                        : isBusy
                          ? "Thinking"
                          : !isReady
                            ? "Connecting"
                            : expanded
                              ? "Full Page"
                              : "Ready"}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={toggleExpanded}
                      aria-label={
                        expanded ? "Collapse assistant to sidebar" : "Expand assistant to full page"
                      }
                      title={expanded ? "Collapse to sidebar" : "Expand to full page"}
                    >
                      {expanded ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={close}
                      aria-label="Close assistant"
                      title="Close assistant"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {pageContext.description}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-auto px-0 text-xs text-primary"
                  onClick={() => setShowGuidedSearch((value) => !value)}
                  aria-expanded={showGuidedSearch}
                >
                  {showGuidedSearch ? "Hide search options" : "Guided search"}
                </Button>
              </div>
            </div>
          </div>

          <ResearchProgress messages={messages} busy={isBusy} />
          <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
            <div className="flex min-h-full flex-col gap-4 px-5 py-5">
              {showGuidedSearch ? (
                <GuidedSearchCard
                  key={selectedAgent}
                  title={
                    selectedAgent === "okf-agent"
                      ? "Search your documents"
                      : "Find the right results"
                  }
                />
              ) : null}
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-border/80 bg-card px-4 py-4 shadow-sm">
                    <p className="text-sm leading-6 text-foreground">{selectedAgentOption.intro}</p>
                  </div>
                  <div className="grid gap-2">
                    {activeSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => sendSuggestion(suggestion)}
                        disabled={!isReady || isBusy}
                        className="rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((message) => (
                <AssistantMessageView
                  key={message.id}
                  message={message}
                  messages={messages}
                  showReasoning={showReasoning}
                />
              ))}
              <ChartFailureNotice messages={messages} busy={isBusy} />

              {isBusy ? (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
                    {isAwaitingChoice ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    {isAwaitingChoice ? "Choose an option above to continue." : "Thinking..."}
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
          <ShortlistTray />

          <div className="shrink-0 border-t border-border bg-background px-5 pb-3 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Popover open={isAgentPickerOpen} onOpenChange={setIsAgentPickerOpen}>
                <PopoverTrigger asChild disabled={isBusy}>
                  <Button
                    type="button"
                    variant="outline"
                    className="max-w-full justify-between gap-2 rounded-full"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="truncate text-left">{selectedAgentOption.name}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[360px] p-0">
                  <Command>
                    <CommandInput placeholder="Search Mastra agents..." />
                    <CommandList>
                      <CommandEmpty>No agents found.</CommandEmpty>
                      <CommandGroup>
                        {AGENT_OPTIONS.map((agent) => (
                          <CommandItem
                            key={agent.id}
                            value={`${agent.id} ${agent.name} ${agent.description}`}
                            onSelect={() => {
                              setSelectedAgent(agent.id);
                              setIsAgentPickerOpen(false);
                            }}
                            className="items-start gap-3 py-3"
                          >
                            <Check
                              className={cn(
                                "mt-0.5 h-4 w-4",
                                selectedAgent === agent.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {agent.name}
                              </p>
                              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {agent.description}
                              </p>
                              <p className="mt-2 truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                {agent.id}
                              </p>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
                <PopoverTrigger asChild disabled={isBusy}>
                  <Button
                    type="button"
                    variant="outline"
                    className="max-w-full justify-between gap-2 rounded-full"
                  >
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
                            <Check
                              className={cn(
                                "mt-0.5 h-4 w-4",
                                selectedModel === model.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {model.id}
                              </p>
                              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {model.description || model.name}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                {model.contextLength ? (
                                  <span>{formatContextLength(model.contextLength)} context</span>
                                ) : null}
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

              <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                {selectedAgentOption.name}
              </span>
              {selectedModelOption?.supportsTools ? (
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  Tools enabled
                </span>
              ) : null}
              <button
                type="button"
                onClick={toggleShowReasoning}
                aria-pressed={showReasoning}
                title={
                  showReasoning
                    ? "Hide reasoning and tool output"
                    : "Show reasoning and tool output"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  showReasoning
                    ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {showReasoning ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {showReasoning ? "Reasoning on" : "Reasoning off"}
              </button>
              {selectedAgent === "web-research-agent" ? (
                <button
                  type="button"
                  onClick={toggleShowImages}
                  aria-pressed={showImages}
                  title={
                    showImages
                      ? "Stop adding images to research answers"
                      : "Add images to research answers"
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                    showImages
                      ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                      : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {showImages ? (
                    <ImageIcon className="h-3.5 w-3.5" />
                  ) : (
                    <ImageOff className="h-3.5 w-3.5" />
                  )}
                  {showImages ? "Images on" : "Images off"}
                </button>
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
              className="flex items-end gap-2 rounded-[24px] border border-border/80 bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
            >
              <Textarea
                ref={draftRef}
                value={draft}
                rows={1}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submitDraft();
                  }
                }}
                placeholder={selectedAgentOption.placeholder}
                aria-label="Message the assistant"
                className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0"
              />
              {isBusy ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => stop()}
                  className="rounded-full"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : null}
              <Button
                type="submit"
                className="rounded-full"
                disabled={!draft.trim() || isBusy || !isReady}
              >
                <ArrowUp className="h-4 w-4" />
                Ask
              </Button>
            </form>

            {modelsError ? <p className="mt-2 text-xs text-destructive">{modelsError}</p> : null}
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              AI can make mistakes. Check important info.
            </p>
          </div>
        </div>
      </RichOutputContext.Provider>
    </CopilotChatConfigurationProvider>
  );
}
