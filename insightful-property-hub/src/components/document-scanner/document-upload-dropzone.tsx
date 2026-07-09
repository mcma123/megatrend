"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDownUp, ImagePlus, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { acceptedUploadTypes, maxUploadSizeBytes } from "@/lib/document-scanner";

type UploadPreview = {
  id: string;
  name: string;
  url: string;
};

type DocumentUploadDropzoneProps = {
  onFilesAccepted: (files: File[]) => void;
};

export function DocumentUploadDropzone({ onFilesAccepted }: DocumentUploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<UploadPreview[]>([]);
  const [error, setError] = useState<string | null>(null);

  const acceptedFormats = useMemo(() => ".jpg,.jpeg,.png,.webp,.heic,.heif", []);

  function validateFiles(files: File[]): File[] {
    const validFiles = files.filter((file) => {
      const hasAcceptedType =
        acceptedUploadTypes.includes(file.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
      if (!hasAcceptedType) {
        setError(`Unsupported file type: ${file.name}`);
        return false;
      }
      if (file.size > maxUploadSizeBytes) {
        setError(`${file.name} exceeds the 15 MB upload limit.`);
        return false;
      }
      return true;
    });
    return validFiles;
  }

  function appendFiles(files: File[]) {
    const validFiles = validateFiles(files);
    if (validFiles.length === 0) return;
    setError(null);
    setPreviews((current) => [
      ...current,
      ...validFiles.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    ]);
    onFilesAccepted(validFiles);
  }

  function removePreview(id: string) {
    setPreviews((current) => current.filter((preview) => preview.id !== id));
  }

  function movePreview(id: string, direction: -1 | 1) {
    setPreviews((current) => {
      const index = current.findIndex((preview) => preview.id === id);
      if (index < 0) return current;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Upload queue
          </div>
          <h3 className="mt-2 font-display text-xl">Upload image</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Add single images or multi-page batches. JPG, PNG, WEBP, and HEIC/HEIF are accepted when
            the browser can read them.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" /> Upload image
          </Button>
          <Button onClick={() => inputRef.current?.click()}>
            <UploadCloud className="h-4 w-4" /> Upload multiple pages
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={acceptedFormats}
        multiple
        className="hidden"
        onChange={(event) => appendFiles(Array.from(event.target.files ?? []))}
      />

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          appendFiles(Array.from(event.dataTransfer.files ?? []));
        }}
        className={[
          "mt-4 rounded-2xl border border-dashed p-8 text-center transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20",
        ].join(" ")}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-primary" />
        <div className="mt-3 font-medium">Drop files here or browse from this device.</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Each image should stay below 15 MB for predictable scan latency.
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {previews.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {previews.map((preview, index) => (
            <div key={preview.id} className="rounded-2xl border border-border bg-card/60 p-3">
              <img
                src={preview.url}
                alt={preview.name}
                className="h-40 w-full rounded-xl object-cover"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{preview.name}</div>
                  <div className="text-xs text-muted-foreground">Page {index + 1}</div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => movePreview(preview.id, -1)}
                    aria-label="Move preview earlier"
                  >
                    <ArrowDownUp className="h-4 w-4 rotate-90" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removePreview(preview.id)}
                    aria-label="Remove preview"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
