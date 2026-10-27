import { ConvexError } from "convex/values";
import { env } from "../_generated/server";
import {
  preparationErrors,
  PREPARATION_MESSAGES,
  type PreparationError,
} from "./signingPreparation";

/** Each worker uses its own least-privilege token; finalisation never reuses the preparation token. */
export type WorkerToken = "documents" | "finalise" | "export";
const token = (kind: WorkerToken) =>
  kind === "export"
    ? env.WINDMILL_SIGNING_EXPORT_TOKEN
    : kind === "finalise"
      ? env.WINDMILL_SIGNING_FINALISE_TOKEN
      : env.WINDMILL_SIGNING_DOCUMENTS_TOKEN;
export const documentsConfigured = (kind: WorkerToken = "documents") =>
  Boolean(
    env.SIGNING_WINDMILL_BASE_URL && env.WINDMILL_WORKSPACE && token(kind),
  );
export const finaliseConfigured = () => documentsConfigured("finalise");
export function workerBase(kind: WorkerToken = "documents") {
  if (!documentsConfigured(kind))
    throw new ConvexError(PREPARATION_MESSAGES.not_configured);
  const url = new URL(env.SIGNING_WINDMILL_BASE_URL!);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ConvexError(PREPARATION_MESSAGES.not_configured);
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/api/w/${encodeURIComponent(env.WINDMILL_WORKSPACE!)}/jobs`;
}
export async function workerRequest(
  path: string,
  body?: unknown,
  kind: WorkerToken = "documents",
) {
  const base = path.startsWith("/get/")
    ? workerBase(kind).replace(/\/jobs$/, "/jobs_u")
    : workerBase(kind);
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
    headers: {
      Authorization: `Bearer ${token(kind)}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error("Signing worker unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty worker response");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024)
        throw new Error("Worker result exceeds limit");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
export async function shortWorker(
  operation: string,
  tenantId: string,
  agreementId: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  let result: unknown;
  try {
    result = await workerRequest(
      "/run_wait_result/p/f/signing/prepare_bundle",
      { operation, tenant_id: tenantId, agreement_id: agreementId, payload },
    );
  } catch {
    throw new ConvexError(PREPARATION_MESSAGES.transfer_failed);
  }
  if (!result || typeof result !== "object")
    throw new ConvexError(PREPARATION_MESSAGES.result_invalid);
  const row = result as Record<string, unknown>;
  if (row.status === "blocked")
    throw new ConvexError(
      PREPARATION_MESSAGES[
        preparationErrors.includes(row.error as PreparationError)
          ? (row.error as PreparationError)
          : "preparation_failed"
      ],
    );
  return row;
}
export function secureUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 12_000)
    throw new ConvexError("Invalid private transfer URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new ConvexError("Invalid private transfer URL");
  return value;
}
