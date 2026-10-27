import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { ArrowLeft, ArrowRight, LockKeyhole, Plus, Save } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  FIELD_LABELS,
  FIELD_TYPES,
  MAX_SIGNING_FIELDS,
  adjustDisplayRect,
  fromDisplayRect,
  initialField,
  normalizeFields,
  toDisplayRect,
  type FieldRect,
  type SigningField,
} from "../../../../convex/lib/signingFields";
import type { PageGeometry } from "../../../../convex/lib/signingPreparation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import { FieldProperties } from "./field-properties";
import { verifiedPdf } from "./private-pdf";

export type PreparationView = FunctionReturnType<typeof api.signingFields.get>;
const errorText = (err: unknown) =>
  err instanceof ConvexError && typeof err.data === "string"
    ? err.data
    : err instanceof Error && !/https?:/.test(err.message)
      ? err.message
      : "PDF preparation could not be saved or displayed. Retry the operation.";

export function SigningFieldEditor({
  agreementId,
  data,
  canEdit,
}: {
  agreementId: Id<"signingAgreements">;
  data: PreparationView;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState(data);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) setInitial(data);
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!data.bundle}>
          {canEdit && data.status === "draft" ? "Prepare signing fields" : "Review PDF and fields"}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[96dvh] w-[98vw] max-w-7xl flex-col gap-2 overflow-hidden p-3 sm:p-5">
        <DialogTitle>PDF field preparation</DialogTitle>
        <DialogDescription>
          Assign fields to signers and review their placement. This preview does not collect
          signatures.
        </DialogDescription>
        {open && initial.bundle && (
          <EditorSession
            agreementId={agreementId}
            initial={initial}
            current={data}
            canEdit={canEdit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function EditorSession({
  agreementId,
  initial,
  current,
  canEdit,
}: {
  agreementId: Id<"signingAgreements">;
  initial: PreparationView;
  current: PreparationView;
  canEdit: boolean;
}) {
  const [loaded, setLoaded] = useState(initial);
  const [fields, setFields] = useState<SigningField[]>(initial.fields);
  const [saved, setSaved] = useState(JSON.stringify(initial.fields));
  const [expectedLayoutRevision, setExpectedLayoutRevision] = useState(initial.layoutRevision);
  const [selected, setSelected] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [type, setType] = useState<SigningField["type"]>("signature");
  const [assigned, setAssigned] = useState(
    initial.participants.find((p) => p.responsibility === "signer")?.key ?? "",
  );
  const [previewSigner, setPreviewSigner] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageReady, setPageReady] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const getUrl = useAction(api.signingFiles.getPreparedUrl);
  const save = useMutation(api.signingFields.save);
  const bundle = loaded.bundle!;
  const stale =
    current.revision !== loaded.revision ||
    current.bundle?.id !== bundle.id ||
    current.layoutRevision !== expectedLayoutRevision;
  const editable =
    canEdit &&
    current.status === "draft" &&
    !stale &&
    !busy &&
    !previewSigner &&
    !!pdf &&
    pageReady;
  const dirty = JSON.stringify(fields) !== saved;
  const active = fields.find((f) => f.key === selected);
  useEffect(() => {
    const abort = new AbortController();
    let task: { destroy: () => Promise<void> } | undefined;
    let privateUrl: string | null = null;
    setPdf(null);
    setLoadingError(null);
    if (current.bundle?.id !== bundle.id) {
      setLoadingError(
        "The PDF changed. Prepare a new bundle if needed, then reload the field preparation.",
      );
      return;
    }
    void (async () => {
      try {
        const link = await getUrl({ agreementId, expectedBundleId: bundle.id });
        abort.signal.throwIfAborted();
        if (link.pdfHash !== bundle.pdfHash)
          throw new Error("PDF reference changed. Reload the preparation");
        const blob = await verifiedPdf(link.url, bundle.pdfHash, abort.signal);
        privateUrl = URL.createObjectURL(blob);
        const pdfjs = await import("pdfjs-dist");
        abort.signal.throwIfAborted();
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
        const loading = pdfjs.getDocument({
          url: privateUrl,
          useSystemFonts: true,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
        });
        task = loading;
        const document = await loading.promise;
        abort.signal.throwIfAborted();
        if (document.numPages !== bundle.pages.length)
          throw new Error("PDF page count does not match its protected manifest");
        setPdf(document);
      } catch (err) {
        if (!abort.signal.aborted) setLoadingError(errorText(err));
      }
    })();
    return () => {
      abort.abort();
      void task?.destroy();
      if (privateUrl) URL.revokeObjectURL(privateUrl);
    };
  }, [agreementId, bundle.id, bundle.pdfHash, bundle.pages.length, current.bundle?.id, getUrl]);
  const updateField = (key: string, patch: Partial<SigningField>) => {
    if (!editable) return;
    setFields((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    if (patch.pageIndex !== undefined) setPageIndex(patch.pageIndex);
  };
  const remove = (key: string) => {
    if (!editable) return;
    setFields((all) => all.filter((f) => f.key !== key));
    setSelected(null);
  };
  function addField() {
    if (!editable || !assigned || fields.length >= MAX_SIGNING_FIELDS) return;
    const field = initialField(type, assigned, bundle.pages[pageIndex], crypto.randomUUID());
    setFields([...fields, field]);
    setSelected(field.key);
  }
  const visibleFields = previewSigner
    ? fields.filter((f) => f.participantKey === previewSigner)
    : fields;
  const selectedParticipant = loaded.participants.find((p) => p.key === previewSigner);
  return (
    <>
      {stale && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 p-2 text-sm"
        >
          <span>
            The draft, PDF or fields changed. Unsaved placements are preserved until you reload.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!current.bundle}
            onClick={() => {
              setLoaded(current);
              setFields(current.fields);
              setSaved(JSON.stringify(current.fields));
              setExpectedLayoutRevision(current.layoutRevision);
              setSelected(null);
              setPageIndex(0);
              setError(null);
            }}
          >
            Discard edits and reload
          </Button>
        </div>
      )}
      {!canEdit && current.status === "draft" && (
        <p className="text-xs text-muted-foreground">
          Editing requires recent administrator MFA. Unsaved placements are preserved.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2 border-b pb-2">
        <Field label="Page" htmlFor="layout-page">
          <NativeSelect
            id="layout-page"
            value={pageIndex}
            onChange={(e) => {
              setPageIndex(Number(e.target.value));
              setSelected(null);
            }}
          >
            {bundle.pages.map((_, i) => (
              <option key={i} value={i}>
                {i + 1} / {bundle.pages.length}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button
          size="icon"
          variant="outline"
          aria-label="Previous PDF page"
          disabled={pageIndex === 0}
          onClick={() => {
            setPageIndex(pageIndex - 1);
            setSelected(null);
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="Next PDF page"
          disabled={pageIndex >= bundle.pages.length - 1}
          onClick={() => {
            setPageIndex(pageIndex + 1);
            setSelected(null);
          }}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Field label="Zoom" htmlFor="layout-zoom">
          <NativeSelect
            id="layout-zoom"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.5, 0.75, 1, 1.5, 2, 3].map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Participant preview" htmlFor="layout-preview">
          <NativeSelect
            id="layout-preview"
            value={previewSigner}
            onChange={(e) => {
              setPreviewSigner(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">All fields · preparation</option>
            {loaded.participants
              .filter((p) => p.responsibility === "signer")
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} · stage {p.stage}
                </option>
              ))}
          </NativeSelect>
        </Field>
        {previewSigner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const ordered = visibleFields
                .filter((f) => f.required)
                .sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x);
              const index = ordered.findIndex((f) => f.key === selected);
              const next = ordered[(index + 1) % ordered.length];
              if (next) {
                setPageIndex(next.pageIndex);
                setSelected(next.key);
              }
            }}
          >
            Next required field
          </Button>
        )}
      </div>
      {selectedParticipant && (
        <p className="text-xs text-muted-foreground">
          Preview for {selectedParticipant.name} ({selectedParticipant.role}), stage{" "}
          {selectedParticipant.stage}. {visibleFields.filter((f) => f.required).length} required
          fields. No signatures or answers are submitted here.
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-[320px] min-w-0 overflow-auto rounded-md border bg-muted/50 lg:min-h-0">
          {loadingError ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              {loadingError}
            </p>
          ) : pdf ? (
            <PdfFieldPage
              key={`${bundle.id}:${pageIndex}`}
              pdf={pdf}
              geometry={bundle.pages[pageIndex]}
              zoom={zoom}
              fields={visibleFields.filter((f) => f.pageIndex === pageIndex)}
              participants={loaded.participants}
              selected={selected}
              editable={editable}
              onSelect={setSelected}
              onChange={updateField}
              onRemove={remove}
              onReady={setPageReady}
            />
          ) : (
            <p role="status" className="p-4 text-sm">
              Verifying and loading the protected PDF…
            </p>
          )}
        </div>
        <aside className="space-y-3 overflow-y-auto rounded-md border p-3">
          {!previewSigner && (
            <>
              <h3 className="font-medium">Signing fields</h3>
              <Field label="New field type" htmlFor="layout-type">
                <NativeSelect
                  id="layout-type"
                  value={type}
                  disabled={!editable}
                  onChange={(e) => setType(e.target.value as SigningField["type"])}
                >
                  {FIELD_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {FIELD_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="New field signer" htmlFor="layout-signer">
                <NativeSelect
                  id="layout-signer"
                  value={assigned}
                  disabled={!editable}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Choose a signer</option>
                  {loaded.participants
                    .filter((p) => p.responsibility === "signer")
                    .map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name} · {p.role}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Button
                variant="outline"
                disabled={!editable || !assigned || fields.length >= MAX_SIGNING_FIELDS}
                onClick={addField}
              >
                <Plus className="h-4 w-4" />
                Add field on page {pageIndex + 1}
              </Button>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {fields.length} / {MAX_SIGNING_FIELDS} fields. Every signer needs a required signature
            before approval.
          </p>
          <ul className="max-h-40 space-y-1 overflow-auto">
            {visibleFields.map((f) => (
              <li key={f.key}>
                <button
                  className={`w-full rounded border px-2 py-2 text-left text-xs focus-visible:ring-2 ${selected === f.key ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                  onClick={() => {
                    setSelected(f.key);
                    setPageIndex(f.pageIndex);
                  }}
                >
                  {f.label} · p{f.pageIndex + 1} ·{" "}
                  {loaded.participants.find((p) => p.key === f.participantKey)?.name}
                  {f.required && " *"}
                </button>
              </li>
            ))}
          </ul>
          {active && !previewSigner && (
            <FieldProperties
              key={active.key}
              field={active}
              fields={fields}
              participants={loaded.participants}
              pageCount={bundle.pages.length}
              disabled={!editable}
              onChange={(patch) => updateField(active.key, patch)}
              onRemove={() => remove(active.key)}
              onRepeat={(pages) => {
                if (!editable || active.type !== "initials") return;
                if (fields.length + pages.length > MAX_SIGNING_FIELDS) {
                  setError("The repeated fields exceed the 400-field limit");
                  return;
                }
                const repeats = pages.map((page) => ({
                  ...active,
                  key: crypto.randomUUID(),
                  pageIndex: page,
                }));
                setFields([...fields, ...repeats]);
              }}
            />
          )}
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <p role="status" className="text-xs text-muted-foreground">
          {dirty
            ? "Unsaved field changes"
            : loaded.layoutId === null
              ? "Field preparation not saved for this PDF"
              : `Saved layout revision ${expectedLayoutRevision}`}
          . {current.status !== "draft" && "Preparation is locked during approval."}
        </p>
        {canEdit && current.status === "draft" && (
          <Button
            disabled={
              busy ||
              stale ||
              !pdf ||
              !pageReady ||
              !!previewSigner ||
              (!dirty && loaded.layoutId !== null)
            }
            onClick={async () => {
              if (saving.current || stale) return;
              saving.current = true;
              setBusy(true);
              setError(null);
              try {
                const normalized = normalizeFields(fields, bundle.pages, loaded.participants);
                const result = await save({
                  agreementId,
                  expectedRevision: loaded.revision,
                  expectedLayoutRevision,
                  bundleId: bundle.id,
                  fields: normalized,
                });
                setExpectedLayoutRevision(result.version);
                setFields(result.fields);
                setSaved(JSON.stringify(result.fields));
                setLoaded((previous) => ({ ...previous, layoutId: result.layoutId }));
              } catch (err) {
                setError(errorText(err));
              } finally {
                saving.current = false;
                setBusy(false);
              }
            }}
          >
            <Save className="h-4 w-4" />
            {busy ? "Saving…" : "Save field preparation"}
          </Button>
        )}
      </div>
      {error && <FormError message={error} />}
    </>
  );
}

function PdfFieldPage({
  pdf,
  geometry,
  zoom,
  fields,
  participants,
  selected,
  editable,
  onSelect,
  onChange,
  onRemove,
  onReady,
}: {
  pdf: PDFDocumentProxy;
  geometry: PageGeometry;
  zoom: number;
  fields: SigningField[];
  participants: PreparationView["participants"];
  selected: string | null;
  editable: boolean;
  onSelect: (key: string) => void;
  onChange: (key: string, patch: Partial<SigningField>) => void;
  onRemove: (key: string) => void;
  onReady: (ready: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0, ready: false });
  const [error, setError] = useState<string | null>(null);
  const gesture = useRef<{
    key: string;
    pointer: number;
    x: number;
    y: number;
    rect: FieldRect;
    mode: "move" | "resize";
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width || !canvas.current) return;
    let disposed = false;
    let rendering: { cancel: () => void } | undefined;
    setError(null);
    onReady(false);
    gesture.current = null;
    setSize((previous) => ({ ...previous, ready: false }));
    void (async () => {
      try {
        const page = await pdf.getPage(geometry.pageIndex + 1);
        if (disposed || !canvas.current) return;
        if (
          page.view.some((value, i) => Math.abs(value - geometry.cropBox[i]) > 0.001) ||
          Math.abs(page.userUnit - geometry.userUnit) > 0.0001 ||
          ((page.rotate % 360) + 360) % 360 !== geometry.rotation
        )
          throw new Error("Page geometry does not match the protected manifest");
        const base = page.getViewport({ scale: 1, rotation: geometry.rotation });
        const scale = Math.min(
          (Math.max(1, width - 24) / base.width) * zoom,
          8192 / base.width,
          8192 / base.height,
          Math.sqrt(4_000_000 / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale, rotation: geometry.rotation });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
        );
        const element = canvas.current;
        element.width = Math.ceil(viewport.width * ratio);
        element.height = Math.ceil(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        const context = element.getContext("2d");
        if (!context) throw new Error("PDF canvas unavailable");
        const task = page.render({
          canvas: element,
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        rendering = task;
        await task.promise;
        if (!disposed) {
          setSize({ width: viewport.width, height: viewport.height, ready: true });
          onReady(true);
        }
      } catch (err) {
        if (!disposed) setError(errorText(err));
      }
    })();
    return () => {
      disposed = true;
      rendering?.cancel();
    };
  }, [pdf, geometry, width, zoom, onReady]);
  const rotationSwap = geometry.rotation === 90 || geometry.rotation === 270;
  const physicalWidth = rotationSwap ? geometry.heightPt : geometry.widthPt,
    physicalHeight = rotationSwap ? geometry.widthPt : geometry.heightPt;
  function start(
    event: PointerEvent<HTMLButtonElement>,
    field: SigningField,
    mode: "move" | "resize",
  ) {
    onSelect(field.key);
    if (!editable || !size.ready || !sheet.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = sheet.current.getBoundingClientRect();
    gesture.current = {
      key: field.key,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect: toDisplayRect(field, geometry.rotation),
      mode,
      width: bounds.width,
      height: bounds.height,
    };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!editable || !current || current.pointer !== event.pointerId) return;
    event.preventDefault();
    const rect = adjustDisplayRect(
      current.rect,
      (event.clientX - current.x) / current.width,
      (event.clientY - current.y) / current.height,
      current.mode === "resize",
      8 / physicalWidth,
      8 / physicalHeight,
    );
    onChange(current.key, fromDisplayRect(rect, geometry.rotation));
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, field: SigningField, resize: boolean) {
    if (!editable) return;
    if (!resize && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      onRemove(field.key);
      return;
    }
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    onSelect(field.key);
    const step = event.shiftKey ? 10 : 1;
    const rect = adjustDisplayRect(
      toDisplayRect(field, geometry.rotation),
      (delta[0] * step) / physicalWidth,
      (delta[1] * step) / physicalHeight,
      resize,
      8 / physicalWidth,
      8 / physicalHeight,
    );
    onChange(field.key, fromDisplayRect(rect, geometry.rotation));
  }
  return (
    <div ref={container} className="min-h-full min-w-full p-3">
      {error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!size.ready && !error && (
        <p className="p-3 text-sm" role="status">
          Rendering page {geometry.pageIndex + 1}…
        </p>
      )}
      <div
        ref={sheet}
        className="relative mx-auto w-fit bg-white shadow"
        style={size.ready ? { width: size.width, height: size.height } : undefined}
      >
        <canvas ref={canvas} aria-label={`PDF page ${geometry.pageIndex + 1}`} />
        {size.ready &&
          !error &&
          fields.map((field) => {
            const rect = toDisplayRect(field, geometry.rotation);
            const participant = participants.find((p) => p.key === field.participantKey);
            const label =
              field.type === "full_name" && field.readOnly
                ? participant?.name
                : field.type === "signing_date"
                  ? "Signing date · server"
                  : field.readOnly
                    ? field.fixedValue === "true" && field.type === "checkbox"
                      ? "☑"
                      : field.fixedValue === "false" && field.type === "checkbox"
                        ? "☐"
                        : field.fixedValue
                    : field.label;
            return (
              <div
                key={field.key}
                className={`absolute border-2 ${selected === field.key ? "z-20 border-primary ring-2 ring-primary/30" : "border-sky-600/70"}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              >
                <button
                  type="button"
                  className="absolute inset-0 flex h-full w-full touch-none items-center justify-start gap-1 overflow-hidden bg-sky-100/75 px-1 text-left text-[clamp(8px,1vw,12px)] text-slate-900 focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`${field.label}, ${participant?.name}, page ${field.pageIndex + 1}${field.required ? ", required" : ""}. Arrow keys move the field.`}
                  onClick={() => onSelect(field.key)}
                  onPointerDown={(event) => start(event, field, "move")}
                  onPointerMove={move}
                  onPointerUp={() => {
                    gesture.current = null;
                  }}
                  onPointerCancel={() => {
                    gesture.current = null;
                  }}
                  onLostPointerCapture={() => {
                    gesture.current = null;
                  }}
                  onKeyDown={(event) => keyboard(event, field, false)}
                >
                  {field.readOnly && <LockKeyhole className="h-3 w-3 shrink-0" />}
                  <span className="truncate">
                    {label}
                    {field.required && " *"}
                  </span>
                </button>
                {editable && selected === field.key && (
                  <button
                    type="button"
                    className="absolute -bottom-2 -right-2 z-30 h-6 w-6 touch-none rounded border border-primary bg-background text-xs text-primary shadow"
                    aria-label={`Resize ${field.label}. Arrow keys change size.`}
                    onPointerDown={(event) => start(event, field, "resize")}
                    onPointerMove={move}
                    onPointerUp={() => {
                      gesture.current = null;
                    }}
                    onPointerCancel={() => {
                      gesture.current = null;
                    }}
                    onLostPointerCapture={() => {
                      gesture.current = null;
                    }}
                    onKeyDown={(event) => keyboard(event, field, true)}
                  >
                    ↘
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
