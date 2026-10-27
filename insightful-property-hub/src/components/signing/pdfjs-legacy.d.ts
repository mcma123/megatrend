// PDF.js's Node compatibility build exposes the same document API.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export { getDocument } from "pdfjs-dist";
}
