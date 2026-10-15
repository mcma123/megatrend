import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/portfolio/form-fields";
import {
  ACCEPTED_UPLOAD_TYPES,
  DOCUMENT_TYPE_LABELS,
  formatBytes,
  type DocumentType,
} from "@/lib/documents";
import { useDocumentUpload } from "@/lib/use-document-upload";
import { cn } from "@/lib/utils";
import { useVoiceForm } from "@/lib/voice/form-registry";
import { documentUploadVoiceFields } from "@/lib/voice/forms";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type QueueItem = {
  key: string;
  file: File;
  state: "pending" | "uploading" | "done" | "failed";
  error?: string;
};

/**
 * Single or bulk upload. Pass `tenantId` to fix the client (portal, client page);
 * staff without it pick the client in the dialog. Pass `open`/`onOpenChange` to control it.
 * The voice assistant can pre-fill client, property and type; a person always picks the files.
 */
export function DocumentUploadDialog({
  trigger,
  tenantId,
  propertyId,
  defaultType,
  title = "Upload documents",
  onUploaded,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tenantId?: Id<"tenants">;
  propertyId?: Id<"properties">;
  defaultType?: DocumentType;
  title?: string;
  /** Called with each successfully created document (e.g. to attach it to an action). */
  onUploaded?: (documentId: Id<"documents">, filename: string) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [selectedTenant, setSelectedTenant] = useState<string>(tenantId ?? "");
  const [selectedProperty, setSelectedProperty] = useState<string>(propertyId ?? "");
  const [declaredType, setDeclaredType] = useState<DocumentType | "">(defaultType ?? "");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload } = useDocumentUpload();

  const clients = useQuery(api.clients.list, open && !tenantId ? {} : "skip");
  const effectiveTenant = (tenantId ?? selectedTenant) as Id<"tenants"> | "";
  const properties = useQuery(
    api.properties.list,
    open && effectiveTenant && !propertyId ? { tenantId: effectiveTenant } : "skip",
  );

  useEffect(() => {
    if (open) {
      setQueue([]);
      setSelectedTenant(tenantId ?? "");
      setSelectedProperty(propertyId ?? "");
      setDeclaredType(defaultType ?? "");
    }
  }, [open, tenantId, propertyId, defaultType]);

  useVoiceForm({
    formId: "document.upload",
    title,
    enabled: open,
    fields: documentUploadVoiceFields({
      clients: tenantId
        ? undefined
        : (clients ?? []).map((client) => ({ value: client.tenantId, label: client.name })),
      properties: propertyId
        ? undefined
        : (properties ?? []).map((property) => ({ value: property._id, label: property.name })),
    }),
    values: { tenantId: selectedTenant, propertyId: selectedProperty, declaredType },
    setValues: (patch) => {
      if (typeof patch.tenantId === "string") {
        setSelectedTenant(patch.tenantId);
        setSelectedProperty("");
      }
      if (typeof patch.propertyId === "string") setSelectedProperty(patch.propertyId);
      if (typeof patch.declaredType === "string")
        setDeclaredType(patch.declaredType as DocumentType);
    },
  });

  const addFiles = (files: FileList | File[]) => {
    const next = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      state: "pending" as const,
    }));
    setQueue((current) => [...current, ...next].slice(0, 20));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  const startUpload = async () => {
    if (!effectiveTenant) {
      toast.error("Choose a client first");
      return;
    }
    setRunning(true);
    let succeeded = 0;
    for (const item of queue) {
      if (item.state === "done") continue;
      setQueue((current) =>
        current.map((q) =>
          q.key === item.key ? { ...q, state: "uploading", error: undefined } : q,
        ),
      );
      const result = await upload(item.file, {
        tenantId: effectiveTenant,
        declaredType: declaredType || undefined,
        propertyId: (propertyId ?? (selectedProperty || undefined)) as Id<"properties"> | undefined,
      });
      if (result.ok) {
        succeeded += 1;
        onUploaded?.(result.documentId, item.file.name);
      }
      setQueue((current) =>
        current.map((q) =>
          q.key === item.key
            ? result.ok
              ? { ...q, state: "done" }
              : { ...q, state: "failed", error: result.error }
            : q,
        ),
      );
    }
    setRunning(false);
    if (succeeded > 0) {
      toast.success(
        `${succeeded} document${succeeded === 1 ? "" : "s"} uploaded. Processing has started.`,
      );
    }
  };

  const allDone = queue.length > 0 && queue.every((item) => item.state === "done");

  return (
    <Dialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            PDF, Word, Excel, images or text, up to 25 MB each. Documents are read and their key
            details extracted automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!tenantId ? (
            <Field label="Client" htmlFor="upload-client">
              <NativeSelect
                id="upload-client"
                value={selectedTenant}
                onChange={(e) => {
                  setSelectedTenant(e.target.value);
                  setSelectedProperty("");
                }}
                disabled={running}
              >
                <option value="">
                  {clients === undefined ? "Loading clients…" : "Choose a client"}
                </option>
                {clients?.map((client) => (
                  <option key={client.tenantId} value={client.tenantId}>
                    {client.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Document type"
              htmlFor="upload-type"
              hint="Leave on auto-detect if unsure."
            >
              <NativeSelect
                id="upload-type"
                value={declaredType}
                onChange={(e) => setDeclaredType(e.target.value as DocumentType | "")}
                disabled={running}
              >
                <option value="">Auto-detect</option>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!propertyId ? (
              <Field label="Property" htmlFor="upload-property" hint="Optional">
                <NativeSelect
                  id="upload-property"
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  disabled={running || !effectiveTenant}
                >
                  <option value="">Not linked</option>
                  {properties?.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <FileUp className="h-6 w-6 text-primary" />
            <p className="mt-2 text-sm font-medium">Drop files here</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={running}
              onClick={() => inputRef.current?.click()}
            >
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_UPLOAD_TYPES}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {queue.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {queue.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.file.name}</div>
                    <div
                      className={cn(
                        "text-xs",
                        item.error ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {item.error ?? formatBytes(item.file.size)}
                    </div>
                  </div>
                  {item.state === "uploading" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : item.state === "done" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  ) : item.state === "failed" ? (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setQueue((current) => current.filter((q) => q.key !== item.key))
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={running}>
            {allDone ? "Close" : "Cancel"}
          </Button>
          {!allDone ? (
            <Button
              type="button"
              onClick={() => void startUpload()}
              disabled={running || queue.length === 0 || !effectiveTenant}
            >
              {running ? "Uploading…" : `Upload ${queue.length || ""}`.trim()}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
