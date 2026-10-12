import { Doc, Id } from "../_generated/dataModel";

export type StageName = "parse" | "knowledge" | "extract";
export type Stage = NonNullable<
  Doc<"documents">["processingStages"]
>[StageName];
export type Stages = Record<StageName, Stage>;
export const STAGE_NAMES: StageName[] = ["parse", "knowledge", "extract"];

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function errorDetails(value: unknown) {
  const r = asRecord(value);
  const e = asRecord(r.error);
  const raw =
    typeof value === "string"
      ? value
      : String(e.message ?? r.message ?? "Processing did not succeed");
  const error = raw
    .replace(/https?:\/\/\S+/gi, "[URL removed]")
    .replace(/Bearer\s+\S+/gi, "Bearer [removed]")
    .slice(0, 400);
  const errorKind = /429|rate.?limit/i.test(raw)
    ? "rate_limit"
    : /timeout|timed out|connection|network|502|503|504|500|storage unavailable/i.test(
          raw,
        )
      ? "transport"
      : /401|403|credential|configured|variable.*empty/i.test(raw)
        ? "configuration"
        : /400|422|invalid|malformed|no usable|no readable|unsupported/i.test(
              raw,
            )
          ? "invalid_input"
          : "unknown";
  return {
    error,
    errorKind,
    retryable:
      errorKind === "transport" ||
      errorKind === "rate_limit" ||
      errorKind === "unknown",
  };
}

export function initialStages(
  attemptId: Id<"processingAttempts"> | undefined,
  now: number,
): Stages {
  return Object.fromEntries(
    STAGE_NAMES.map((name) => [
      name,
      { status: "pending", attemptId, updatedAt: now, retryable: false },
    ]),
  ) as Stages;
}

export function resultStages(
  result: Record<string, unknown>,
  attemptId?: Id<"processingAttempts">,
  previous?: Stages,
): Stages {
  const now = Date.now();
  const raw = asRecord(result.stages);
  const extraction = asRecord(result.extraction);
  const fields = Array.isArray(extraction.fields) ? extraction.fields : [];
  return Object.fromEntries(
    STAGE_NAMES.map((name) => {
      const item = asRecord(raw[name]);
      const fallback =
        name === "parse"
          ? result.docling_status === "success"
            ? "succeeded"
            : result.parsed_json_key
              ? "partial"
              : "failed"
          : name === "knowledge"
            ? result.okf_bundle_root
              ? "succeeded"
              : "failed"
            : fields.length
              ? extraction.truncated
                ? "partial"
                : "succeeded"
              : "failed";
      let status = [
        "pending",
        "running",
        "succeeded",
        "failed",
        "partial",
        "skipped",
      ].includes(String(item.status))
        ? (item.status as Stage["status"])
        : (fallback as Stage["status"]);
      if (
        name === "knowledge" &&
        status === "succeeded" &&
        !result.okf_bundle_root
      )
        status = "failed";
      if (
        name === "extract" &&
        status !== "skipped" &&
        (!fields.length ||
          fields.some(
            (f) =>
              typeof asRecord(f).key !== "string" ||
              typeof asRecord(f).value !== "string",
          ))
      )
        status = "failed";
      if (
        name === "parse" &&
        result.docling_status !== undefined &&
        !["success", "SUCCESS"].includes(String(result.docling_status))
      )
        status = result.parsed_json_key ? "partial" : "failed";
      const problem = status === "failed" || status === "partial";
      const details = problem
        ? errorDetails(
            item.error ??
              (name === "knowledge"
                ? result.okf_error
                : name === "extract"
                  ? "No usable or complete extraction returned"
                  : "Parsing coverage is incomplete"),
          )
        : {};
      const key =
        name === "parse"
          ? result.parsed_json_key
          : name === "knowledge"
            ? result.okf_bundle_root
            : undefined;
      return [
        name,
        {
          status,
          attemptId,
          startedAt: previous?.[name].startedAt,
          completedAt: now,
          updatedAt: now,
          retryable: false,
          ...details,
          ...(typeof item.error_kind === "string" && problem
            ? {
                errorKind: item.error_kind.slice(0, 40),
                retryable: item.retryable === true,
              }
            : {}),
          ...(typeof key === "string"
            ? { artifactKey: key.slice(0, 1000) }
            : {}),
          ...(name === "parse" && typeof result.parsed_json_bucket === "string"
            ? { artifactBucket: result.parsed_json_bucket.slice(0, 100) }
            : {}),
          ...(item.reused === true ? { reused: true } : {}),
        },
      ];
    }),
  ) as Stages;
}

export function clientStageMessage(name: StageName, stage: Stage) {
  if (stage.errorKind === "timeout")
    return "Processing is taking longer than expected. Your team is checking it; please do not upload a duplicate.";
  if (stage.status === "failed" || stage.status === "partial")
    return name === "knowledge"
      ? "Document search is temporarily unavailable. Your team can repair it; extracted details remain available for review."
      : "Your team needs to check this document before its details can be used. You can view the original or contact your team.";
  return undefined;
}
