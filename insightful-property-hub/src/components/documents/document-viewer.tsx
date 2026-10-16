import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Download, FileText, RefreshCcw, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DocumentViewerContext } from "@/lib/document-viewer-context";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const PdfPreview = lazy(() => import("./pdf-preview"));

export function DocumentViewerProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Id<"documents"> | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { isAuthenticated, profile } = useCyphersoftAuth();
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => setSelected(null), [href, isAuthenticated, profile?.userId]);
  const open = useCallback((id: Id<"documents">) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(id);
  }, []);
  return (
    <DocumentViewerContext.Provider value={open}>
      {children}
      {isAuthenticated && selected ? (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) setSelected(null);
          }}
        >
          <DialogContent
            className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:h-[94dvh] sm:w-[96vw] sm:max-w-[1600px]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus();
            }}
          >
            <ViewerBody key={selected} documentId={selected} onClose={() => setSelected(null)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </DocumentViewerContext.Provider>
  );
}

function ViewerBody({ documentId, onClose }: { documentId: Id<"documents">; onClose: () => void }) {
  const file = useQuery(api.documentPreviews.view, { documentId });
  const request = useMutation(api.documentPreviews.request);
  const convex = useConvex();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const requested = useRef(false);
  useEffect(() => {
    if (file?.kind !== "converted" || file.previewStatus || requested.current) return;
    requested.current = true;
    void request({ documentId }).catch(() =>
      setError("The preview could not be requested. Please retry."),
    );
  }, [documentId, file, request]);
  const retry = async () => {
    setError("");
    setAttempt((value) => value + 1);
    if (file?.kind === "converted") {
      try {
        await request({ documentId, retry: true });
      } catch {
        setError("The preview could not be requested. Please retry.");
      }
    }
  };
  const download = async () => {
    setDownloading(true);
    try {
      const fresh = await convex.query(api.documentPreviews.view, { documentId });
      if (!fresh?.originalUrl) throw new Error();
      const response = await fetch(fresh.originalUrl);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fresh.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error("The original could not be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  };
  const converted = file?.kind === "converted";
  const url = converted ? file?.previewUrl : file?.originalUrl;
  return (
    <>
      <header className="border-b px-4 py-4 pr-12">
        <DialogTitle className="truncate text-base">
          {file?.filename ?? "Document viewer"}
        </DialogTitle>
        <DialogDescription className="mt-1">
          {converted
            ? "Converted preview · download the original for the source file."
            : "Original document"}
        </DialogDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          {file?.originalUrl ? (
            <Button
              variant="outline"
              size="sm"
              disabled={downloading}
              onClick={() => void download()}
            >
              <Download className="h-4 w-4" />
              {downloading ? "Downloading…" : "Download original"}
            </Button>
          ) : null}
          {file ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void retry()}
              disabled={file.previewStatus === "preparing"}
            >
              <RefreshCcw className="h-4 w-4" />
              Retry preview
            </Button>
          ) : null}
          {file?.isStaff ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/documents/$id" params={{ id: documentId }} onClick={onClose}>
                <FileText className="h-4 w-4" />
                Document details / review
              </Link>
            </Button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {file === undefined ? (
          <Message>Loading document…</Message>
        ) : !file || !file.originalUrl ? (
          <Message>This document is unavailable or you do not have access to it.</Message>
        ) : error ? (
          <Message>{error}</Message>
        ) : converted && !url ? (
          <Message>
            {file.previewError ??
              (file.previewStatus === "ready"
                ? "The saved preview is unavailable. Retry the preview, or download the original."
                : "Preparing document preview…")}
          </Message>
        ) : !url ? (
          <Message>This document could not be displayed.</Message>
        ) : file.kind === "pdf" || converted ? (
          <Suspense fallback={<Message>Loading viewer…</Message>}>
            <PdfPreview key={`${url}:${attempt}`} url={url} />
          </Suspense>
        ) : file.kind === "image" ? (
          <ImagePreview key={`${url}:${attempt}`} url={url} filename={file.filename} />
        ) : file.kind === "text" ? (
          <TextPreview key={`${url}:${attempt}`} url={url} />
        ) : (
          <Message>This file format cannot be previewed. Download the original to view it.</Message>
        )}
      </div>
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground"
    >
      <p>{children}</p>
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = await response.text();
        if (!controller.signal.aborted) setText(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [url]);
  if (error)
    return (
      <Message>
        This document could not be loaded. Retry the preview, or download the original.
      </Message>
    );
  if (text === null) return <Message>Loading document…</Message>;
  // Escaped text, including HTML/Markdown: uploaded scripts are never executed.
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-6 text-sm">{text}</pre>
  );
}

function ImagePreview({ url, filename }: { url: string; filename: string }) {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-center gap-2 border-b p-2">
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
      {error ? (
        <Message>
          This image could not be loaded. Retry the preview, or download the original.
        </Message>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-muted/60 p-4">
          <img
            src={url}
            alt={filename}
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
            className="mx-auto"
            onError={() => setError(true)}
          />
        </div>
      )}
    </div>
  );
}
