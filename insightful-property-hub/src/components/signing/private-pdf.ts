/** Private transfers never enter persistent browser storage or third-party viewers. */
export async function verifiedPdf(url: string, hash: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok || !response.body) throw new Error("Private download failed");
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 50 * 1024 * 1024) throw new Error("PDF exceeds limit");
      parts.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel();
  }
  const blob = new Blob(parts, { type: "application/pdf" });
  const actual = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== hash) throw new Error("PDF integrity check failed");
  signal.throwIfAborted();
  return blob;
}
