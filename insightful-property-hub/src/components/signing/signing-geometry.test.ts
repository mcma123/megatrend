// @vitest-environment node
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { fieldToPdfRect, toDisplayRect } from "../../../../convex/lib/signingFields";
import { GEOMETRY_PDF } from "./signing-geometry.fixture";

let document: PDFDocumentProxy;
let loadingTask: { destroy: () => Promise<void> } | undefined;
beforeAll(async () => {
  vi.stubGlobal("DOMMatrix", DOMMatrix);
  vi.stubGlobal("ImageData", ImageData);
  vi.stubGlobal("Path2D", Path2D);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(GEOMETRY_PDF, "base64")),
    useSystemFonts: true,
  });
  loadingTask = loading;
  document = await loading.promise;
});
afterAll(async () => {
  await loadingTask?.destroy();
  vi.unstubAllGlobals();
});

test("field placement matches actual PDF.js crop/unit/rotation transforms at four zoom levels", async () => {
  const rects = [
    { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.8, y: 0.9, width: 0.2, height: 0.1 },
    { x: 0.25, y: 0.75, width: 0.2, height: 0.05 },
    { x: 0.02, y: 0.02, width: 0.03, height: 0.03 },
  ];
  let comparisons = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    expect(page.view).toEqual([10, 20, 590, 780]);
    expect(page.userUnit).toBe(2);
    for (const scale of [0.25, 0.5, 1, 2])
      for (const rect of rects) {
        const viewport = page.getViewport({ scale });
        const raw = fieldToPdfRect(rect, { cropBox: [10, 20, 590, 780] });
        const actual = [
          ...viewport.convertToViewportPoint(raw[0], raw[1]),
          ...viewport.convertToViewportPoint(raw[2], raw[3]),
        ];
        const expected = toDisplayRect(rect, page.rotate);
        expect(Math.min(actual[0], actual[2]) / viewport.width).toBeCloseTo(expected.x, 10);
        expect(Math.min(actual[1], actual[3]) / viewport.height).toBeCloseTo(expected.y, 10);
        expect(Math.abs(actual[2] - actual[0]) / viewport.width).toBeCloseTo(expected.width, 10);
        expect(Math.abs(actual[3] - actual[1]) / viewport.height).toBeCloseTo(expected.height, 10);
        comparisons++;
      }
  }
  expect(comparisons).toBe(80);
});
