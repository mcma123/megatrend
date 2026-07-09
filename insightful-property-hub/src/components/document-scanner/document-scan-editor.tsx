"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Crop, RotateCcw, RotateCw, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createDefaultCorners,
  type DocumentCorners,
  getEffectiveCorners,
  normalizeCorners,
  type ScanPage,
} from "@/lib/document-scanner";

type CornerKey = keyof DocumentCorners;

type DocumentScanEditorProps = {
  page: ScanPage | null;
  onCornersChange: (corners: DocumentCorners) => void;
  onResetCorners: () => void;
  onRotate: (delta: number) => void;
  onConfirmCrop: () => void;
};

export function DocumentScanEditor({
  page,
  onCornersChange,
  onResetCorners,
  onRotate,
  onConfirmCrop,
}: DocumentScanEditorProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [draggingCorner, setDraggingCorner] = useState<CornerKey | null>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);

  const effectiveCorners = useMemo(() => (page ? getEffectiveCorners(page) : undefined), [page]);

  useEffect(() => {
    const updateSize = () => {
      if (!imageRef.current) return;
      setDisplaySize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight,
      });
      setNaturalSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [page?.id]);

  useEffect(() => {
    const onPointerUp = () => setDraggingCorner(null);
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, []);

  function applyPointerPosition(clientX: number, clientY: number) {
    if (
      !page ||
      !draggingCorner ||
      !imageRef.current ||
      naturalSize.width === 0 ||
      naturalSize.height === 0
    )
      return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * naturalSize.width;
    const y = ((clientY - rect.top) / rect.height) * naturalSize.height;
    const next = normalizeCorners(
      {
        ...(effectiveCorners ?? createDefaultCorners(naturalSize.width, naturalSize.height)),
        [draggingCorner]: { x, y },
      },
      naturalSize.width,
      naturalSize.height,
    );
    onCornersChange(next);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingCorner) return;
    applyPointerPosition(event.clientX, event.clientY);
  }

  function projectPoint(point: { x: number; y: number }) {
    if (
      naturalSize.width === 0 ||
      naturalSize.height === 0 ||
      displaySize.width === 0 ||
      displaySize.height === 0
    ) {
      return { x: 0, y: 0 };
    }
    return {
      x: (point.x / naturalSize.width) * displaySize.width,
      y: (point.y / naturalSize.height) * displaySize.height,
    };
  }

  const polygon = effectiveCorners
    ? [
        projectPoint(effectiveCorners.topLeft),
        projectPoint(effectiveCorners.topRight),
        projectPoint(effectiveCorners.bottomRight),
        projectPoint(effectiveCorners.bottomLeft),
      ]
    : [];

  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Preview editor
          </div>
          <h3 className="mt-2 font-display text-xl">Current scan preview</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Auto-detected borders can be refined manually. Drag each corner handle into place before
            processing the page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onResetCorners} disabled={!page}>
            <Undo2 className="h-4 w-4" /> Reset corners
          </Button>
          <Button variant="outline" onClick={() => onRotate(-90)} disabled={!page}>
            <RotateCcw className="h-4 w-4" /> Rotate left
          </Button>
          <Button variant="outline" onClick={() => onRotate(90)} disabled={!page}>
            <RotateCw className="h-4 w-4" /> Rotate right
          </Button>
          <Button onClick={onConfirmCrop} disabled={!page}>
            <Crop className="h-4 w-4" /> Confirm crop
          </Button>
        </div>
      </div>

      {!page ? (
        <div className="mt-4 grid min-h-[24rem] place-items-center rounded-2xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
          Select or capture a page to edit its crop.
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-border bg-slate-950/96 p-4">
            <div
              onPointerMove={handlePointerMove}
              className="relative mx-auto overflow-hidden rounded-xl"
              style={{ maxWidth: "56rem" }}
            >
              <div
                className="origin-center transition-transform"
                style={{ transform: `scale(${zoom}) rotate(${page.rotation}deg)` }}
              >
                <img
                  ref={imageRef}
                  src={page.processedImageUrl ?? page.originalImageUrl}
                  alt={page.name}
                  className="max-h-[34rem] w-full rounded-xl object-contain"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setDisplaySize({ width: image.clientWidth, height: image.clientHeight });
                    setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                  }}
                />
                {polygon.length === 4 && (
                  <svg className="pointer-events-none absolute inset-0 h-full w-full">
                    <polygon
                      points={polygon.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="rgba(53, 121, 255, 0.18)"
                      stroke="rgba(120, 190, 255, 0.95)"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {polygon.length === 4 &&
                  (["topLeft", "topRight", "bottomRight", "bottomLeft"] as CornerKey[]).map(
                    (key, index) => {
                      const point = polygon[index];
                      return (
                        <button
                          key={key}
                          type="button"
                          className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-lg"
                          style={{ left: point.x, top: point.y }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            setDraggingCorner(key);
                          }}
                        />
                      );
                    },
                  )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setZoom((current) => Math.max(0.8, Number((current - 0.1).toFixed(2))))
              }
            >
              <Search className="h-4 w-4" /> Zoom out
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setZoom((current) => Math.min(1.8, Number((current + 0.1).toFixed(2))))
              }
            >
              <Search className="h-4 w-4" /> Zoom in
            </Button>
            <div className="text-xs text-muted-foreground">Zoom {Math.round(zoom * 100)}%</div>
            <div className="text-xs text-muted-foreground">Rotation {page.rotation}°</div>
            {page.confidence !== undefined && (
              <div className="text-xs text-muted-foreground">
                Edge confidence {Math.round(page.confidence * 100)}%
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
