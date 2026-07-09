export type Point = {
  x: number;
  y: number;
};

export type DocumentCorners = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

export type EnhancementMode =
  | "original"
  | "grayscale"
  | "black_white"
  | "color_enhanced"
  | "high_contrast"
  | "receipt"
  | "contract"
  | "id_passport";

export type ScanPageStatus = "new" | "detecting" | "ready" | "processing" | "processed" | "failed";

export type ScanPage = {
  id: string;
  name: string;
  originalImageUrl: string;
  originalImageBase64?: string;
  detectedCorners?: DocumentCorners;
  manualCorners?: DocumentCorners;
  processedImageUrl?: string;
  processedImageBase64?: string;
  enhancementMode: EnhancementMode;
  rotation: number;
  status: ScanPageStatus;
  error?: string;
  previewOutlineUrl?: string;
  confidence?: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  denoise: number;
  upscale: boolean;
  autoClean: boolean;
};

export type ExportOptions = {
  fileName: string;
  pageSize: "a4" | "letter" | "original";
  orientation: "auto" | "portrait" | "landscape";
  compression: "low" | "medium" | "high";
};

export type ScannerApiEnvelope<Result> = {
  success: boolean;
  result?: Result;
  error?: string;
  processingTimeMs?: number;
  scanQualityMetadata?: Record<string, unknown>;
};

export const enhancementOptions: Array<{
  value: EnhancementMode;
  label: string;
  description: string;
}> = [
  { value: "original", label: "Original", description: "Keep the source image untouched." },
  {
    value: "grayscale",
    label: "Grayscale",
    description: "Flatten color noise for standard pages.",
  },
  {
    value: "black_white",
    label: "Black & White",
    description: "High-contrast threshold for crisp text.",
  },
  {
    value: "color_enhanced",
    label: "Color Enhanced",
    description: "Lift contrast without removing color.",
  },
  {
    value: "high_contrast",
    label: "High Contrast",
    description: "Push edges harder for faint scans.",
  },
  {
    value: "receipt",
    label: "Receipt Mode",
    description: "Bias toward tiny text and low-light photos.",
  },
  {
    value: "contract",
    label: "Contract Mode",
    description: "Preserve type and signatures on long-form pages.",
  },
  {
    value: "id_passport",
    label: "ID / Passport",
    description: "Balance clarity and color fidelity for IDs.",
  },
];

export const maxUploadSizeBytes = 15 * 1024 * 1024;
export const acceptedUploadTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export function createDefaultCorners(
  width: number,
  height: number,
  insetRatio = 0.06,
): DocumentCorners {
  const insetX = Math.max(width * insetRatio, 12);
  const insetY = Math.max(height * insetRatio, 12);
  return {
    topLeft: { x: insetX, y: insetY },
    topRight: { x: width - insetX, y: insetY },
    bottomRight: { x: width - insetX, y: height - insetY },
    bottomLeft: { x: insetX, y: height - insetY },
  };
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(point.x, 0), width),
    y: Math.min(Math.max(point.y, 0), height),
  };
}

export function normalizeCorners(
  corners: DocumentCorners,
  width: number,
  height: number,
): DocumentCorners {
  return {
    topLeft: clampPoint(corners.topLeft, width, height),
    topRight: clampPoint(corners.topRight, width, height),
    bottomRight: clampPoint(corners.bottomRight, width, height),
    bottomLeft: clampPoint(corners.bottomLeft, width, height),
  };
}

export function rotateByQuarterTurns(rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return Math.round(normalized / 90) * 90;
}

export function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function duplicatePage(page: ScanPage): ScanPage {
  return {
    ...page,
    id: crypto.randomUUID(),
    name: `${page.name} copy`,
    status: page.processedImageBase64 ? "processed" : "ready",
    error: undefined,
  };
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const [, encoded = dataUrl] = dataUrl.split(",", 2);
  return encoded;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export async function getImageDimensions(
  imageUrl: string,
): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Could not read image dimensions."));
    image.src = imageUrl;
  });
}

export async function createScanPageFromFile(file: File): Promise<ScanPage> {
  const dataUrl = await fileToDataUrl(file);
  const { width, height } = await getImageDimensions(dataUrl);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, "") || "Scanned page",
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
}

export function getEffectiveCorners(page: ScanPage): DocumentCorners | undefined {
  return page.manualCorners ?? page.detectedCorners;
}
