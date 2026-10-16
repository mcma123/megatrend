import { cp, mkdir } from "node:fs/promises";

// Keep PDF fonts, CMaps and image decoders local; no document data goes to a CDN.
const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const target = new URL("../public/pdfjs/", import.meta.url);
await mkdir(target, { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(new URL(directory, source), new URL(directory, target), { recursive: true });
}
