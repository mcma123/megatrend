from typing import Any
import re


def _record(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _failure(value: Any, fallback: str) -> dict:
    data = _record(value)
    error = _record(data.get("error"))
    raw = str(error.get("message") or data.get("message") or value or fallback)
    kind = "rate_limit" if re.search(r"429|rate.?limit", raw, re.I) else "transport" if re.search(r"timeout|timed out|connection|network|50[0-4]|storage unavailable", raw, re.I) else "configuration" if re.search(r"401|403|credential|configured|variable.*empty", raw, re.I) else "invalid_input" if re.search(r"400|422|invalid|malformed|no usable|no readable|unsupported", raw, re.I) else "unknown"
    safe = re.sub(r"https?://\S+", "[URL removed]", raw, flags=re.I)
    safe = re.sub(r"Bearer\s+\S+", "Bearer [removed]", safe, flags=re.I)
    return {"error": safe[:400], "error_kind": kind, "retryable": kind in ("transport", "rate_limit", "unknown")}


def main(parse_result: dict, okf_result: Any, extraction: dict, attempt_id: str | None = None,
         retry_stage: str | None = None, reused_knowledge: dict | None = None) -> dict:
    parse_result = _record(parse_result)
    saved = _record(parse_result.get("saved_json_to_minio"))
    confidence = _record(parse_result.get("confidence"))
    markdown = parse_result.get("markdown")
    markdown = markdown if isinstance(markdown, str) else ""
    extraction = _record(extraction)
    parse_status = str(parse_result.get("status") or "unknown").lower()
    parse_errors = parse_result.get("errors") or []
    parse_complete = parse_status == "success" and not parse_errors
    truncated = extraction.get("truncated") is True
    fields = extraction.get("fields")
    extract_valid = isinstance(fields, list) and bool(fields) and all(isinstance(f, dict) and isinstance(f.get("key"), str) and isinstance(f.get("value"), str) for f in fields)
    okf_result = _record(reused_knowledge) if retry_stage == "extract" else _record(okf_result)
    okf_ok = bool(okf_result.get("bundle_root")) and isinstance(okf_result.get("bundle_root"), str)
    complete = parse_complete and extract_valid and not truncated
    page_count = markdown.count("<!-- page break -->") + 1 if "<!-- page break -->" in markdown else None
    parse = {"status": "succeeded" if parse_complete else "partial" if markdown else "failed", "retryable": False}
    if not parse_complete:
        parse.update(_failure(parse_result.get("error") or parse_errors or None, "Docling did not confirm complete parsing or reported parser errors."))
    if parse_result.get("reused"):
        parse["reused"] = True
    knowledge = {"status": "succeeded" if okf_ok else "failed", "retryable": False}
    if not okf_ok:
        knowledge.update(_failure(okf_result, "Knowledge bundle creation did not succeed."))
    if retry_stage == "extract":
        knowledge["reused"] = True
    if not saved.get("key") and not okf_ok:
        knowledge = {"status": "skipped", "retryable": False}
    extract = {"status": "succeeded" if extract_valid and not truncated else "partial" if extract_valid else "failed", "retryable": False}
    if not extract_valid or truncated:
        extract.update(_failure(extraction.get("error") or None, "Source text was truncated." if truncated else "No usable fields returned."))
    if retry_stage == "knowledge" or not markdown:
        extract = {"status": "skipped", "retryable": False}
    return {
        "contract_version": 1, "attempt_id": attempt_id,
        "stages": {"parse": parse, "knowledge": knowledge, "extract": extract},
        "completeness": {"complete": complete, "truncated": truncated},
        "provenance": {"page_count_source": "markdown_markers" if page_count is not None else "unknown", "field_pages_verified": False},
        "parsed_json_key": saved.get("key"), "parsed_json_bucket": saved.get("bucket"),
        "okf_bundle_root": okf_result.get("bundle_root") if okf_ok else None,
        "okf_error": knowledge.get("error"),
        "docling_status": parse_result.get("status"), "docling_confidence": confidence.get("mean_score"),
        "page_count": page_count, "text_preview": markdown[:1500], "text_length": len(markdown), "extraction": extraction,
    }
