import { useContext, useState } from "react";
import { useComponent, useRenderTool } from "@copilotkit/react-core/v2/headless";
import { z } from "zod";
import { ArrowUpRight, Copy, FileText, ImageOff, Loader2, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  normalizeResultCards,
  isRichTool,
  parseResult,
  record,
  resultError,
  safeUrl,
  text,
  type ResultCard,
} from "./rich-output-data";

import { RichOutputContext } from "./assistant-runtime-context";

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 space-y-3 break-words text-sm leading-7 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            safeUrl(href) ? (
              <a
                href={safeUrl(href)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: () => null,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs [&_td]:border-b [&_td]:p-2 [&_th]:border-b [&_th]:p-2">
                {children}
              </table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function FollowUp({ prompt, label = "Explore this" }: { prompt: string; label?: string }) {
  const { followUp, busy } = useContext(RichOutputContext);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto justify-start whitespace-normal px-0 text-left text-xs text-primary"
      disabled={busy}
      onClick={() => followUp(prompt)}
    >
      {label}
      <ArrowUpRight className="ml-1 h-3 w-3 shrink-0" />
    </Button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState("Copy");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("Copied");
        } catch {
          setState("Could not copy");
        }
      }}
    >
      <Copy className="mr-1 h-3 w-3" />
      {state}
    </Button>
  );
}

function ResultImage({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="grid h-36 place-content-center bg-muted text-xs text-muted-foreground">
      <ImageOff className="mx-auto mb-2 h-5 w-5" />
      Image unavailable
    </div>
  ) : (
    <img
      src={src}
      alt={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-36 w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function ResultCards({ cards, toolName }: { cards: ResultCard[]; toolName: string }) {
  const isDocument = toolName.startsWith("okf_");
  return (
    <div className="grid min-w-0 gap-3 @lg/assistant:grid-cols-2">
      {cards.map((card, index) => (
        <article
          key={`${card.url ?? card.reference ?? card.title}-${index}`}
          className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          {card.imageUrl ? <ResultImage src={card.imageUrl} title={card.title} /> : null}
          <div className="space-y-2 p-4">
            <div className="flex items-start gap-2">
              {isDocument ? <FileText className="mt-1 h-4 w-4 shrink-0 text-primary" /> : null}
              <h4 className="break-words text-sm font-semibold leading-6">{card.title}</h4>
            </div>
            {card.label ? <p className="text-sm font-medium text-primary">{card.label}</p> : null}
            {card.description ? (
              <p className="whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
                {card.description}
              </p>
            ) : null}
            {card.reference ? (
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                {card.reference}
              </p>
            ) : null}
            {card.evidence ? (
              <details className="text-xs">
                <summary className="cursor-pointer py-1 font-medium">View evidence</summary>
                <div className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3">
                  <AssistantMarkdown>{card.evidence}</AssistantMarkdown>
                </div>
              </details>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {card.url ? (
                <a
                  href={card.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4"
                >
                  Open source
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              ) : null}
              <FollowUp
                prompt={
                  isDocument
                    ? `Read and summarize this document, citing the evidence: ${card.reference ?? card.title}`
                    : `Investigate this result in more detail: ${card.url ?? card.title}`
                }
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

const sourceSchema = z.object({
  title: z.string().max(240),
  url: z.string().max(2000).optional(),
  reference: z.string().max(500).optional(),
});
const summarySchema = z.object({
  title: z.string().max(240),
  summary: z.string().max(8000),
  facts: z.array(z.object({ label: z.string().max(120), value: z.string().max(2000) })).max(20),
  sources: z.array(sourceSchema).max(12),
});
const comparisonSchema = z.object({
  title: z.string().max(240),
  columns: z.array(z.string().max(120)).min(1).max(8),
  rows: z
    .array(
      z.object({
        label: z.string().max(240),
        values: z.array(z.string().max(1000)).max(8),
        source: z.string().max(2000),
      }),
    )
    .max(30),
});
const chartSchema = z.object({
  title: z.string().max(240),
  unit: z.string().max(80),
  points: z
    .array(
      z.object({
        label: z.string().max(120),
        value: z.number().finite(),
        source: z.string().max(2000),
      }),
    )
    .min(1)
    .max(24),
});
const draftSchema = z.object({
  title: z.string().max(240),
  body: z.string().max(12000),
  price: z.string().max(120),
});

function SourceLinks({ sources }: { sources: z.infer<typeof sourceSchema>[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source, index) =>
        safeUrl(source.url) ? (
          <a
            key={index}
            href={safeUrl(source.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full truncate rounded-full border px-3 py-1 text-xs text-primary"
          >
            {source.title}
            <ArrowUpRight className="ml-1 inline h-3 w-3" />
          </a>
        ) : (
          <span key={index} className="break-all text-xs text-muted-foreground">
            {source.reference || source.title}
          </span>
        ),
      )}
    </div>
  );
}

export function SummaryCard(props: z.infer<typeof summarySchema>) {
  const parsed = summarySchema.safeParse(props);
  if (!parsed.success) return <LoadingCard />;
  const data = parsed.data;
  return (
    <section className="space-y-4 rounded-2xl border border-primary/20 bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
        Key findings
      </p>
      <h3 className="text-lg font-semibold">{data.title}</h3>
      <AssistantMarkdown>{data.summary}</AssistantMarkdown>
      <dl className="divide-y">
        {data.facts.map((fact, index) => (
          <div key={index} className="grid gap-1 py-2 text-sm sm:grid-cols-2">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="break-words font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <SourceLinks sources={data.sources} />
      <FollowUp
        prompt={`Go deeper into the findings about ${data.title}, with supporting sources.`}
        label="Explore the findings"
      />
    </section>
  );
}

export function ComparisonCard(props: z.infer<typeof comparisonSchema>) {
  const [sortColumn, setSortColumn] = useState(-1);
  const parsed = comparisonSchema.safeParse(props);
  if (!parsed.success) return <LoadingCard />;
  const data = parsed.data;
  const rows =
    sortColumn < 0
      ? data.rows
      : [...data.rows].sort((a, b) =>
          (a.values[sortColumn] ?? "").localeCompare(b.values[sortColumn] ?? "", undefined, {
            numeric: true,
          }),
        );
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <h3 className="p-4 font-semibold">{data.title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{data.title}. Select a column heading to sort.</caption>
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3">Option</th>
              {data.columns.map((column, index) => (
                <th
                  key={index}
                  className="p-3"
                  aria-sort={sortColumn === index ? "ascending" : "none"}
                >
                  <button
                    type="button"
                    onClick={() => setSortColumn(index)}
                    className="whitespace-nowrap"
                  >
                    {column} ↕
                  </button>
                </th>
              ))}
              <th className="p-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                <th scope="row" className="min-w-32 p-3 font-medium">
                  {row.label}
                </th>
                {data.columns.map((_, column) => (
                  <td key={column} className="min-w-28 p-3 leading-5">
                    {row.values[column] || "Unknown"}
                  </td>
                ))}
                <td className="p-3">
                  {safeUrl(row.source) ? (
                    <a
                      href={safeUrl(row.source)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="break-all">{row.source || "Not provided"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-4">
        <FollowUp
          prompt={`Explain the main tradeoffs in the comparison: ${data.title}.`}
          label="Explain the tradeoffs"
        />
      </div>
    </section>
  );
}

export function ChartCard(props: z.infer<typeof chartSchema>) {
  const parsed = chartSchema.safeParse(props);
  if (!parsed.success) return <LoadingCard />;
  const data = parsed.data;
  return (
    <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <h3 className="font-semibold">{data.title}</h3>
      <p className="text-xs text-muted-foreground">{data.unit}</p>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.points}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={48} />
            <Tooltip />
            <Bar dataKey="value" name={data.unit} fill="var(--primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer">View values and sources</summary>
        <ul className="space-y-2 pt-2">
          {data.points.map((point, index) => (
            <li key={index}>
              {point.label}: {point.value} {data.unit} ·{" "}
              {safeUrl(point.source) ? (
                <a
                  href={safeUrl(point.source)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Source
                </a>
              ) : (
                point.source
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function DraftCard(props: z.infer<typeof draftSchema>) {
  const parsed = draftSchema.safeParse(props);
  if (!parsed.success) return <LoadingCard />;
  const data = parsed.data;
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Listing draft</p>
      <h3 className="font-semibold">{data.title}</h3>
      <p className="text-sm font-medium text-primary">{data.price || "Price not specified"}</p>
      <AssistantMarkdown>{data.body}</AssistantMarkdown>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={`${data.title}\n${data.price}\n\n${data.body}`} />
        <FollowUp prompt={`Refine this listing draft: ${data.title}`} label="Refine draft" />
      </div>
    </section>
  );
}

function LoadingCard() {
  const { busy } = useContext(RichOutputContext);
  if (!busy)
    return (
      <p role="status" className="rounded-2xl border bg-card p-4 text-xs text-muted-foreground">
        This response is incomplete. Ask the assistant to try again.
      </p>
    );
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-xs text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      Preparing the response…
    </div>
  );
}

function BackendToolResult({
  name,
  status,
  result,
}: {
  name: string;
  status: string;
  result?: unknown;
}) {
  const { showReasoning } = useContext(RichOutputContext);
  const { busy } = useContext(RichOutputContext);
  const title = name.startsWith("okf_")
    ? "document lookup"
    : name.startsWith("facebook_marketplace_")
      ? "Marketplace request"
      : name.includes("image_search")
        ? "image search"
        : name.startsWith("windmill_")
          ? "source research"
          : "assistant step";
  if (status !== "complete")
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground"
      >
        {busy ? <Search className="h-3 w-3 animate-pulse" /> : null}
        {busy ? `${title}…` : "No complete result is available for this step."}
      </div>
    );
  if (resultError(result))
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/20 p-3 text-xs text-destructive"
      >
        Could not complete {title}. Ask the assistant to try another source.
      </div>
    );
  const parsed = parseResult(result);
  const cards = normalizeResultCards(name, parsed);
  const isDoctor = name === "facebook_marketplace_doctor";
  const isDraft = name === "facebook_marketplace_draft";
  const data = record(parsed);
  return (
    <div className="space-y-3">
      {isDoctor ? (
        <section className="rounded-2xl border bg-card p-4">
          <h3 className="text-sm font-semibold">Marketplace setup</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            {text(data.summary ?? data.message ?? data.status) ||
              "Setup check returned. See the assistant’s assessment below."}
          </p>
        </section>
      ) : isDraft ? (
        <DraftCard
          title={text(data.title) || "Marketplace draft"}
          body={
            text(data.body ?? data.description ?? data.draft ?? data.content, 12000) ||
            "The draft is included in the assistant’s response."
          }
          price={text(data.price)}
        />
      ) : cards.length ? (
        <ResultCards cards={cards} toolName={name} />
      ) : (
        <p className="rounded-xl border p-3 text-xs text-muted-foreground">
          {isRichTool(name) ? "No results returned." : `Completed ${title}.`}
        </p>
      )}
      {showReasoning ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Tool details: {name}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">
            {JSON.stringify(parsed, null, 2)?.slice(0, 16000)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/** Register presentation-only tools; browser actions here never persist records. */
export function RichOutputRegistry({ agentId }: { agentId: string }) {
  useRenderTool(
    {
      name: "*",
      agentId,
      render: (props) => (
        <BackendToolResult name={props.name} status={props.status} result={props.result} />
      ),
    },
    [agentId],
  );
  useComponent(
    {
      name: "show_summary",
      agentId,
      description:
        "Show grounded research or document findings with key facts and retrieved sources. Unknown facts must say Unknown.",
      parameters: summarySchema,
      render: SummaryCard,
    },
    [agentId],
  );
  useComponent(
    {
      name: "show_comparison",
      agentId,
      description:
        "Compare retrieved options in a sortable table. Every row needs a source URL or document reference. Keep values aligned with columns.",
      parameters: comparisonSchema,
      render: ComparisonCard,
    },
    [agentId],
  );
  useComponent(
    {
      name: "show_chart",
      agentId,
      description:
        "Chart numeric facts found in tool results. Every point needs its retrieved source; never invent values or convert unknown values to zero.",
      parameters: chartSchema,
      render: ChartCard,
    },
    [agentId],
  );
  useComponent(
    {
      name: "show_listing_draft",
      agentId,
      description:
        "Present a copyable Marketplace listing draft based on the user's notes or retrieved draft. Does not publish or save anything.",
      parameters: draftSchema,
      render: DraftCard,
    },
    [agentId],
  );
  return null;
}
