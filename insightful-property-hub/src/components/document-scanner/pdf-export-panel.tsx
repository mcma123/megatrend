"use client";

import type { ReactNode } from "react";
import { Download, FileArchive, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ExportOptions } from "@/lib/document-scanner";

type PDFExportPanelProps = {
  options: ExportOptions;
  canDownload: boolean;
  isGenerating: boolean;
  isSaving: boolean;
  onOptionsChange: (patch: Partial<ExportOptions>) => void;
  onGeneratePdf: () => void;
  onDownloadPdf: () => void;
  onSaveDocument: () => void;
};

export function PDFExportPanel({
  options,
  canDownload,
  isGenerating,
  isSaving,
  onOptionsChange,
  onGeneratePdf,
  onDownloadPdf,
  onSaveDocument,
}: PDFExportPanelProps) {
  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            PDF export
          </div>
          <h3 className="mt-2 font-display text-xl">Export PDF</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Generate the final multi-page PDF, download it, or save the finished record back into
            documents.
          </p>
        </div>
        <FileArchive className="mt-1 h-5 w-5 text-primary" />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="File name">
          <Input
            value={options.fileName}
            onChange={(event) => onOptionsChange({ fileName: event.target.value })}
          />
        </Field>
        <Field label="Page size">
          <Select
            value={options.pageSize}
            onValueChange={(value: ExportOptions["pageSize"]) =>
              onOptionsChange({ pageSize: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a4">A4</SelectItem>
              <SelectItem value="letter">Letter</SelectItem>
              <SelectItem value="original">Original</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Orientation">
          <Select
            value={options.orientation}
            onValueChange={(value: ExportOptions["orientation"]) =>
              onOptionsChange({ orientation: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="portrait">Portrait</SelectItem>
              <SelectItem value="landscape">Landscape</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Compression">
          <Select
            value={options.compression}
            onValueChange={(value: ExportOptions["compression"]) =>
              onOptionsChange({ compression: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onGeneratePdf} disabled={isGenerating}>
          <FileArchive className="h-4 w-4" /> {isGenerating ? "Generating PDF..." : "Generate PDF"}
        </Button>
        <Button variant="outline" onClick={onDownloadPdf} disabled={!canDownload}>
          <Download className="h-4 w-4" /> Download PDF
        </Button>
        <Button variant="secondary" onClick={onSaveDocument} disabled={!canDownload || isSaving}>
          <Save className="h-4 w-4" /> {isSaving ? "Saving..." : "Save to Documents"}
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
