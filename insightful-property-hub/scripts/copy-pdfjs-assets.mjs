import { cp, mkdir } from "node:fs/promises";

// Keep PDF fonts, CMaps and image decoders local; no document data goes to a CDN.
const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const target = new URL("../public/pdfjs/", import.meta.url);
await mkdir(target, { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(new URL(directory, source), new URL(directory, target), { recursive: true });
}
// The standalone signer portal (/sign) loads PDF.js as a same-origin module outside the app bundle.
await mkdir(new URL("build/", target), { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  await cp(new URL(`legacy/build/${file}`, source), new URL(`build/${file}`, target));
}
