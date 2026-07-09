import { useMemo, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Camera, FileScan, Save, ScanLine, Sparkles } from "lucide-react";
import { DocumentCameraCapture } from "@/components/document-scanner/document-camera-capture";
import { DocumentEnhancementControls } from "@/components/document-scanner/document-enhancement-controls";
import { DocumentScanEditor } from "@/components/document-scanner/document-scan-editor";
import { DocumentUploadDropzone } from "@/components/document-scanner/document-upload-dropzone";
import { PDFExportPanel } from "@/components/document-scanner/pdf-export-panel";
import { ScanPagesManager } from "@/components/document-scanner/scan-pages-manager";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createDefaultCorners,
  createScanPageFromFile,
  duplicatePage,
  getEffectiveCorners,
  getImageDimensions,
  reorderItems,
  rotateByQuarterTurns,
  stripDataUrlPrefix,
  type DocumentCorners,
  type ExportOptions,
  type ScanPage,
  type ScannerApiEnvelope,
} from "@/lib/document-scanner";
import { getClientBySlug } from "@/lib/mock-data";

type DetectEdgesResult = {
  detectedCorners: DocumentCorners;
  confidenceScore?: number;
  previewImage?: string;
  warning?: string;
};

type ProcessImageResult = {
  processedImage: string;
  metadata?: Record<string, unknown>;
};

type GeneratePdfResult = {
  pdfBase64?: string;
  pdfUrl?: string;
  metadata?: {
    pageCount?: number;
    fileSize?: number;
  };
};

export const Route = createFileRoute("/portal/$clientSlug/documents/scanner")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Document Scanner | ${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      {
        name: "description",
        content: `Capture, process, and export multi-page scanned documents for ${loaderData?.client.name ?? "your client portal"}.`,
      },
    ],
  }),
  component: ClientDocumentScannerPage,
});

function ClientDocumentScannerPage() {
  const { client } = Route.useLoaderData();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready to capture or upload pages.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pdfResult, setPdfResult] = useState<GeneratePdfResult | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [scanSessionId] = useState(() => crypto.randomUUID());
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    fileName: `${client.slug}-scan-${new Date().toISOString().slice(0, 10)}`,
    pageSize: "a4",
    orientation: "auto",
    compression: "medium",
  });

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  );

  async function addFiles(files: File[]) {
    setErrorMessage(null);
    const nextPages: ScanPage[] = [];
    for (const file of files) {
      try {
        nextPages.push(await createScanPageFromFile(file));
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "A file could not be added to the scanner.",
        );
      }
    }
    if (nextPages.length === 0) return;
    setPages((current) => [...current, ...nextPages]);
    setSelectedPageId((current) => current ?? nextPages[0]?.id ?? null);
    setStatusMessage(`${nextPages.length} page(s) added to the scan session.`);
  }

  async function addCapturedImage(dataUrl: string) {
    try {
      const { width, height } = await getImageDimensions(dataUrl);
      const page: ScanPage = {
        id: crypto.randomUUID(),
        name: `Camera page ${pages.length + 1}`,
        originalImageUrl: dataUrl,
        originalImageBase64: stripDataUrlPrefix(dataUrl),
        detectedCorners: createDefaultCorners(width, height),
        manualCorners: createDefaultCorners(width, height),
        enhancementMode: "original",
        rotation: 0,
        status: "ready",
        brightness: 0,
        contrast: 0,
        sharpness: 0,
        denoise: 0,
        upscale: false,
        autoClean: true,
      };
      setPages((current) => [...current, page]);
      setSelectedPageId(page.id);
      setStatusMessage("Camera capture added to the scanner session.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "The captured image could not be added.",
      );
    }
  }

  function updatePage(pageId: string, patch: Partial<ScanPage>) {
    setPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
    );
  }

  function updateSelectedPage(patch: Partial<ScanPage>) {
    if (!selectedPage) return;
    updatePage(selectedPage.id, patch);
  }

  async function callScannerApi<Result>(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<Result> {
    const response = await fetch(`/api/scanner/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as ScannerApiEnvelope<Result>;
    if (!response.ok || !json.success || !json.result) {
      throw new Error(json.error ?? `Scanner backend request failed for ${action}.`);
    }
    return json.result;
  }

  async function detectEdgesForPage(page: ScanPage) {
    setErrorMessage(null);
    updatePage(page.id, { status: "detecting", error: undefined });
    try {
      const result = await callScannerApi<DetectEdgesResult>("detect-edges", {
        imageData: page.originalImageBase64,
        fileName: page.name,
        userId: client.id,
        scanSessionId,
        metadata: {
          clientSlug: client.slug,
          source: "scanner",
        },
      });
      updatePage(page.id, {
        detectedCorners: result.detectedCorners,
        manualCorners: result.detectedCorners,
        previewOutlineUrl: result.previewImage,
        confidence: result.confidenceScore,
        status: "ready",
        error: result.warning,
      });
      setStatusMessage(`Edges detected for ${page.name}.`);
    } catch (error) {
      updatePage(page.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Edge detection failed.",
      });
      setErrorMessage(error instanceof Error ? error.message : "Edge detection failed.");
    }
  }

  async function processSelectedPage() {
    if (!selectedPage) return;
    setErrorMessage(null);
    updateSelectedPage({ status: "processing", error: undefined });
    try {
      const result = await callScannerApi<ProcessImageResult>("process-image", {
        imageData: selectedPage.originalImageBase64,
        cornerPoints: getEffectiveCorners(selectedPage),
        enhancementMode: selectedPage.enhancementMode,
        rotateValue: selectedPage.rotation,
        upscale: selectedPage.upscale,
        cleanupSettings: {
          autoClean: selectedPage.autoClean,
          brightness: selectedPage.brightness,
          contrast: selectedPage.contrast,
          sharpness: selectedPage.sharpness,
          denoise: selectedPage.denoise,
        },
        userId: client.id,
        scanSessionId,
        metadata: {
          clientSlug: client.slug,
          pageId: selectedPage.id,
        },
      });
      updateSelectedPage({
        processedImageUrl: `data:image/jpeg;base64,${result.processedImage}`,
        processedImageBase64: result.processedImage,
        status: "processed",
      });
      setStatusMessage(`Processed ${selectedPage.name}.`);
    } catch (error) {
      updateSelectedPage({
        status: "failed",
        error: error instanceof Error ? error.message : "Processing failed.",
      });
      setErrorMessage(error instanceof Error ? error.message : "Processing failed.");
    }
  }

  async function generatePdf() {
    if (pages.length === 0) {
      setErrorMessage("Add at least one page before generating the PDF.");
      return;
    }
    const processedPages = pages.filter((page) => page.processedImageBase64);
    if (processedPages.length === 0) {
      setErrorMessage("Process at least one page before exporting a PDF.");
      return;
    }
    setIsGeneratingPdf(true);
    setErrorMessage(null);
    try {
      const result = await callScannerApi<GeneratePdfResult>("generate-pdf", {
        pageImages: processedPages.map((page) => ({
          id: page.id,
          name: page.name,
          imageBase64: page.processedImageBase64,
        })),
        pdfFileName: exportOptions.fileName,
        pageSize: exportOptions.pageSize,
        orientation: exportOptions.orientation,
        compression: exportOptions.compression,
        userId: client.id,
        scanSessionId,
        metadata: {
          clientSlug: client.slug,
        },
      });
      setPdfResult(result);
      setStatusMessage(`PDF generated with ${processedPages.length} page(s).`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF generation failed.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  function downloadPdf() {
    if (!pdfResult) return;
    if (pdfResult.pdfUrl) {
      window.open(pdfResult.pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (pdfResult.pdfBase64) {
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${pdfResult.pdfBase64}`;
      link.download = `${exportOptions.fileName}.pdf`;
      link.click();
    }
  }

  async function saveDocument() {
    if (!pdfResult) {
      setErrorMessage("Generate the PDF before saving it to documents.");
      return;
    }
    setIsSavingDocument(true);
    setErrorMessage(null);
    try {
      await callScannerApi("save-document", {
        pdfBase64: pdfResult.pdfBase64,
        pdfUrl: pdfResult.pdfUrl,
        documentName: exportOptions.fileName,
        documentType: "scanner",
        uploadedBy: client.contact,
        userId: client.id,
        scanSessionId,
        scanMetadata: {
          source: "scanner",
          createdFromImages: true,
          pageCount: pages.length,
        },
        metadata: {
          clientSlug: client.slug,
        },
      });
      setStatusMessage("The scanned document record has been saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The document could not be saved.");
    } finally {
      setIsSavingDocument(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Client portal | Document scanner"
        title="Document Scanner"
        description="Capture pages, refine the crop, process them through Windmill, and export a clean PDF back into the client record."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => selectedPage && void detectEdgesForPage(selectedPage)}
              disabled={!selectedPage}
            >
              <ScanLine className="h-4 w-4" /> Auto detect edges
            </Button>
            <Button onClick={() => void processSelectedPage()} disabled={!selectedPage}>
              <FileScan className="h-4 w-4" /> Scan document
            </Button>
          </>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <DocumentCameraCapture onCapture={(dataUrl) => void addCapturedImage(dataUrl)} />
        <DocumentUploadDropzone onFilesAccepted={(files) => void addFiles(files)} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <DocumentScanEditor
            page={selectedPage}
            onCornersChange={(corners) => updateSelectedPage({ manualCorners: corners })}
            onResetCorners={() => {
              if (selectedPage?.detectedCorners) {
                updateSelectedPage({ manualCorners: selectedPage.detectedCorners });
              }
            }}
            onRotate={(delta) => {
              if (!selectedPage) return;
              updateSelectedPage({ rotation: rotateByQuarterTurns(selectedPage.rotation + delta) });
            }}
            onConfirmCrop={() => setStatusMessage("Crop confirmed for the current page.")}
          />
          <ScanPagesManager
            pages={pages}
            selectedPageId={selectedPageId}
            onSelectPage={setSelectedPageId}
            onRenamePage={(pageId, name) => updatePage(pageId, { name })}
            onDeletePage={(pageId) => {
              const remaining = pages.filter((page) => page.id !== pageId);
              setPages(remaining);
              if (selectedPageId === pageId) {
                setSelectedPageId(remaining[0]?.id ?? null);
              }
            }}
            onMovePage={(pageId, direction) =>
              setPages((current) => {
                const index = current.findIndex((page) => page.id === pageId);
                const target = index + direction;
                if (index < 0 || target < 0 || target >= current.length) return current;
                return reorderItems(current, index, target);
              })
            }
            onDuplicatePage={(pageId) =>
              setPages((current) =>
                current.flatMap((page) =>
                  page.id === pageId ? [page, duplicatePage(page)] : [page],
                ),
              )
            }
            onRescanPage={(pageId) => {
              const page = pages.find((item) => item.id === pageId);
              if (page) {
                void detectEdgesForPage(page);
              }
            }}
          />
        </div>

        <div className="space-y-4">
          <DocumentEnhancementControls page={selectedPage} onChange={updateSelectedPage} />
          <PDFExportPanel
            options={exportOptions}
            canDownload={Boolean(pdfResult?.pdfUrl || pdfResult?.pdfBase64)}
            isGenerating={isGeneratingPdf}
            isSaving={isSavingDocument}
            onOptionsChange={(patch) => setExportOptions((current) => ({ ...current, ...patch }))}
            onGeneratePdf={() => void generatePdf()}
            onDownloadPdf={downloadPdf}
            onSaveDocument={() => void saveDocument()}
          />

          <Card className="surface-elevated p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-1 h-5 w-5 text-primary" />
              <div>
                <h3 className="font-display text-lg">Scanner session</h3>
                <p className="mt-2 text-sm text-muted-foreground">{statusMessage}</p>
                {errorMessage && (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {errorMessage}
                  </div>
                )}
                {pdfResult?.metadata && (
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                    <div>Page count: {pdfResult.metadata.pageCount ?? pages.length}</div>
                    {pdfResult.metadata.fileSize && (
                      <div>File size: {Math.round(pdfResult.metadata.fileSize / 1024)} KB</div>
                    )}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => selectedPage && void detectEdgesForPage(selectedPage)}
                    disabled={!selectedPage}
                  >
                    <Camera className="h-4 w-4" /> Auto detect edges
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setStatusMessage(
                        "Add another page by camera or upload to continue this session.",
                      )
                    }
                  >
                    <Save className="h-4 w-4" /> Add page
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}
