import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { UploadCloud, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { documents, getClient } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/documents")({
  head: () => ({ meta: [{ title: "Document intelligence · Megatrend OS" }, { name: "description", content: "Turn lease PDFs, addenda, invoices and memos into structured searchable data." }] }),
  component: DocsPage,
});

function DocsPage() {
  const [drag, setDrag] = useState(false);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Document intelligence"
        title="Every clause, extracted."
        description="Leases, addenda, invoices, memos — classified, parsed, scored for confidence, and surfaced for human review when needed."
      />

      <Card
        className={`surface-elevated mb-6 flex flex-col items-center justify-center gap-2 border-2 border-dashed p-10 transition-colors ${drag ? "border-primary bg-accent/40" : "border-border"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); }}
      >
        <UploadCloud className="h-8 w-8 text-primary" />
        <div className="font-display text-lg">Drop PDFs, DOCX or images</div>
        <div className="text-xs text-muted-foreground">Auto-classified · extracted · flagged within 60 seconds</div>
        <Button className="mt-2">Choose files</Button>
      </Card>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({documents.length})</TabsTrigger>
          <TabsTrigger value="review">Needs review ({documents.filter(d => d.status === "Needs review").length})</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
        </TabsList>
        {(["all", "review", "approved"] as const).map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Card className="surface-elevated p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="py-3 pr-3">File</th><th className="py-3 pr-3">Type</th>
                    <th className="py-3 pr-3">Client</th><th className="py-3 pr-3">Uploaded</th>
                    <th className="py-3 pr-3 text-right">Confidence</th><th className="py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {documents
                    .filter((d) => tab === "all" || (tab === "review" && d.status === "Needs review") || (tab === "approved" && d.status === "Approved"))
                    .map((d) => (
                      <tr key={d.id} className="border-b border-border/50 hover:bg-accent/30">
                        <td className="py-3 pr-3"><Link to="/documents/$id" params={{ id: d.id }} className="font-medium hover:text-primary">{d.name}</Link>
                          {d.missing && <div className="mt-1 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="h-3 w-3" /> {d.missing[0]}</div>}
                        </td>
                        <td className="py-3 pr-3"><span className="tag-pill">{d.type}</span></td>
                        <td className="py-3 pr-3 text-muted-foreground">{getClient(d.clientId)?.name}</td>
                        <td className="py-3 pr-3 font-mono text-xs">{d.uploaded}</td>
                        <td className="py-3 pr-3 text-right font-mono">{Math.round(d.confidence * 100)}%</td>
                        <td className="py-3">
                          <span className={`tag-pill ${d.status === "Approved" ? "!text-success !border-success/40 !bg-success/10" : d.status === "Needs review" ? "!text-warning !border-warning/40 !bg-warning/10" : ""}`}>
                            {d.status === "Approved" ? <CheckCircle2 className="h-3 w-3" /> : null}{d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
