import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PdfPreview({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setPdf(null);
    setPage(1);
    setZoom(1);
    setError("");
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
        const loading = pdfjs.getDocument({
          url,
          useSystemFonts: true,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
        });
        task = loading;
        const result = await loading.promise;
        if (!disposed) setPdf(result);
      })
      .catch(() => {
        if (!disposed)
          setError(
            "This PDF cannot be displayed. It may be damaged or password-protected. You can download the original.",
          );
      });
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !width || !canvas.current) return;
    let disposed = false;
    let task: { cancel: () => void } | undefined;
    setRendering(true);
    void pdf
      .getPage(page)
      .then(async (pdfPage) => {
        if (disposed || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({
          scale: Math.min(2, Math.max(0.25, (width - 32) / base.width)) * zoom,
        });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        const context = element.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        const render = pdfPage.render({
          canvas: element,
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        task = render;
        await render.promise;
        if (!disposed) setRendering(false);
      })
      .catch(() => {
        if (!disposed) {
          setRendering(false);
          setError("This page could not be rendered. Retry the preview, or download the original.");
        }
      });
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [pdf, page, width, zoom]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-center gap-2 border-b bg-background p-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={!pdf || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <label className="flex items-center gap-2 text-sm">
          Page
          <Input
            dictation={false}
            aria-label="Page number"
            type="number"
            min={1}
            max={pdf?.numPages ?? 1}
            value={page}
            className="h-9 w-16"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (pdf && Number.isInteger(next) && next >= 1 && next <= pdf.numPages) setPage(next);
            }}
          />
          <span>of {pdf?.numPages ?? "…"}</span>
        </label>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={() => setZoom(1)}>
          Fit to width
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom in"
          disabled={zoom >= 3}
          onClick={() => setZoom(Math.min(3, zoom + 0.25))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={container}
        className="min-h-0 flex-1 overflow-auto bg-muted/60 p-4"
        aria-busy={!error && (!pdf || rendering)}
      >
        {error ? (
          <p role="alert" className="p-4 text-center text-sm">
            {error}
          </p>
        ) : (
          <>
            {!pdf || rendering ? (
              <p role="status" className="mb-2 text-center text-sm text-muted-foreground">
                Loading page…
              </p>
            ) : null}
            <canvas
              ref={canvas}
              role="img"
              aria-label={`Document page ${page}${pdf ? ` of ${pdf.numPages}` : ""}`}
              className="mx-auto bg-white shadow-sm"
            />
          </>
        )}
      </div>
    </div>
  );
}
